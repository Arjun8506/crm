import { env } from '../../config/env.js';
import { sendMessage as twilioSend } from '../../providers/twilio.js';
import { ApiError, badRequest } from '../../utils/errors.js';
import { renderTemplate } from '../formulas/formula.js';
import { channelStatus, getAccountMailer, getIntegration } from '../integrations/integration.service.js';
import { enqueue, registerHandler } from '../queue/queue.js';
import { emitWorkspace } from '../../sockets/index.js';
import { Interaction } from './interaction.model.js';

const NAMES = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export function normalizeRecipient(channel, raw) {
  const to = String(raw ?? '').trim();
  if (channel === 'email') {
    if (!EMAIL.test(to) || to.length > 254) throw badRequest('Enter a valid email address');
    return to.toLowerCase();
  }
  const phone = to.replace(/[\s().-]/g, '');
  if (!E164.test(phone)) throw badRequest('Phone numbers must be in international format, e.g. +14155550123');
  return phone;
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// Creates the timeline entry and either sends it now (inline, used inside workflow jobs) or queues it.
// If the channel is not configured this FAILS with a clear message: it never records a message as sent.
export async function sendMessage({ account, dataform, record, channel, to, subject, body, values, actor, workflow, inline = false }) {
  if (!NAMES[channel]) throw badRequest('Unsupported channel');
  const status = (await channelStatus(account))[channel];
  if (!status.configured) throw new ApiError(409, 'NOT_CONFIGURED', `${NAMES[channel]} is not set up for this account. An administrator can connect it under Settings > Integrations.`);

  const recipient = normalizeRecipient(channel, to);
  const text = renderTemplate(body, values).trim();
  if (!text) throw badRequest('The message is empty');
  const interaction = await Interaction.create({
    account, workspace: dataform.workspace, dataform: dataform._id, record: record._id, channel, direction: 'outbound', status: 'queued',
    to: recipient, subject: channel === 'email' ? oneLine(renderTemplate(subject, values)).slice(0, 300) || '(no subject)' : undefined, body: text,
    user: actor?._id ?? actor?.id, workflow: workflow?._id,
  });
  if (inline) {
    try { await deliver(interaction._id, { actor }); } catch (err) { await markFailed(interaction._id, err); throw err; }
  } else {
    await enqueue('message.send', { interactionId: String(interaction._id), actor: actor ? { name: actor.name, email: actor.email } : null });
  }
  return Interaction.findById(interaction._id);
}

const changed = (i) => emitWorkspace(i.workspace, 'interaction.changed', { dataformId: String(i.dataform), recordId: String(i.record) });

async function markFailed(id, err) {
  const i = await Interaction.findOneAndUpdate({ _id: id, status: { $in: ['queued', 'sent'] } }, { $set: { status: 'failed', error: String(err.message).slice(0, 500) } }, { returnDocument: 'after' });
  if (i) changed(i);
}

// Sends one queued interaction through its provider. Safe to call again after a failure: only "queued" entries are sent.
export async function deliver(interactionId, { actor } = {}) {
  const i = await Interaction.findOneAndUpdate({ _id: interactionId, status: 'queued' }, { $set: { error: null } }, { returnDocument: 'after' });
  if (!i) return;
  let result;
  if (i.channel === 'email') {
    const mailer = await getAccountMailer(i.account);
    if (!mailer) throw new Error('Email is no longer configured');
    const addr = /<([^>]+)>/.exec(mailer.from)?.[1] ?? mailer.from;
    const name = oneLine(actor?.name).replace(/["<>]/g, '');
    const info = await mailer.send({
      from: name ? `"${name} (via OrgCRM)" <${addr}>` : mailer.from, replyTo: actor?.email || undefined, to: i.to, subject: i.subject, text: i.body,
    });
    result = { providerId: info?.messageId, from: addr };
  } else {
    const twilio = await getIntegration(i.account, 'twilio');
    if (!twilio) throw new Error(`${NAMES[i.channel]} is no longer configured`);
    const wa = i.channel === 'whatsapp';
    const sender = wa ? twilio.settings.whatsappFrom : twilio.settings.smsFrom;
    if (!sender) throw new Error(`No ${NAMES[i.channel]} sender number is configured`);
    const callback = env.PUBLIC_API_URL.startsWith('https://') ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/webhooks/twilio/status/${twilio.id}` : undefined;
    const sent = await twilioSend({ ...twilio.secrets, from: wa ? `whatsapp:${sender}` : sender, to: wa ? `whatsapp:${i.to}` : i.to, body: i.body, statusCallback: callback });
    result = { providerId: sent.providerId, from: sender };
  }
  // "sent" means the provider accepted it. "delivered" only ever comes from a provider callback.
  await Interaction.updateOne({ _id: i._id }, { $set: { status: 'sent', providerId: result.providerId, from: result.from, error: null } });
  changed(i);
}

registerHandler('message.send', ({ interactionId, actor }) => deliver(interactionId, { actor }), {
  onFinalFailure: ({ interactionId }, err) => markFailed(interactionId, err),
});
