import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { objectId, validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { emitWorkspace } from '../../sockets/index.js';
import { followersOf } from '../comments/comment.service.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { Integration } from '../integrations/integration.model.js';
import { decrypt, safeEqual } from '../integrations/secrets.js';
import { notify } from '../notifications/notification.service.js';
import { RecordModel } from '../records/record.model.js';
import { label } from '../records/record.service.js';
import { validateSignature } from '../../providers/twilio.js';
import { Interaction } from './interaction.model.js';

// Public endpoints called by providers. They have no user session, so each one authenticates the *caller*:
// Twilio requests must carry a valid X-Twilio-Signature, inbound email must carry the shared secret header.
const router = Router();
const idParams = z.object({ integrationId: objectId });
const form = express.urlencoded({ extended: false, limit: '100kb' });

async function loadIntegration(req, kind) {
  const doc = await Integration.findOne({ _id: req.params.integrationId, kind, enabled: true }).select('+secrets +webhookSecret').lean();
  if (!doc) throw notFound('Unknown integration');
  return { doc, secrets: decrypt(doc.secrets) };
}

function verifyTwilio(req, secrets) {
  const url = `${env.PUBLIC_API_URL.replace(/\/$/, '')}${req.originalUrl}`;
  if (!validateSignature(secrets.authToken, url, req.body ?? {}, req.get('x-twilio-signature'))) throw forbidden('Invalid signature');
}

const notifyFollowers = async (interaction, record, dataform, title, body) => {
  await notify({
    account: interaction.account, recipients: await followersOf(record._id), type: 'message_received', title, body: body.slice(0, 200),
    link: `/w/${dataform.workspace}/f/${dataform._id}?record=${record._id}`,
  });
  emitWorkspace(interaction.workspace, 'interaction.changed', { dataformId: String(dataform._id), recordId: String(record._id) });
};

router.post('/twilio/status/:integrationId', validate({ params: idParams }), form, async (req, res) => {
  const { doc, secrets } = await loadIntegration(req, 'twilio');
  verifyTwilio(req, secrets);
  const { MessageSid: sid, MessageStatus: status, ErrorCode: code } = req.body;
  const i = sid && (await Interaction.findOne({ account: doc.account, providerId: sid }));
  if (i) {
    // Providers can deliver callbacks out of order: never move backwards from delivered/failed.
    if (status === 'delivered' && i.status !== 'delivered') i.status = 'delivered';
    else if (['failed', 'undelivered'].includes(status) && !['delivered', 'failed'].includes(i.status)) { i.status = 'failed'; i.error = `Twilio reported ${status}${code ? ` (error ${code})` : ''}`; }
    await i.save();
    emitWorkspace(i.workspace, 'interaction.changed', { dataformId: String(i.dataform), recordId: String(i.record) });
  }
  res.status(204).end();
});

// Finds a record whose phone field matches the sender, ignoring formatting such as spaces and dashes.
async function recordByPhone(account, digits) {
  const phoneFields = await FieldDefinition.find({ account, type: 'phone' }).lean();
  const pattern = new RegExp(`^\\+?[^\\d]*${digits.split('').join('[^\\d]*')}[^\\d]*$`);
  for (const f of phoneFields) {
    const record = await RecordModel.findOne({ account, dataform: f.dataform, [`data.${f.key}`]: pattern }).lean();
    if (record) return record;
  }
  return null;
}

router.post('/twilio/inbound/:integrationId', validate({ params: idParams }), form, async (req, res) => {
  const { doc, secrets } = await loadIntegration(req, 'twilio');
  verifyTwilio(req, secrets);
  const wa = String(req.body.From ?? '').startsWith('whatsapp:');
  const from = String(req.body.From ?? '').replace(/^whatsapp:/, '');
  const digits = from.replace(/\D/g, '');
  const record = digits.length >= 7 && digits.length <= 15 ? await recordByPhone(doc.account, digits) : null;
  if (record) {
    const dataform = await Dataform.findById(record.dataform);
    const i = await Interaction.create({
      account: doc.account, workspace: record.workspace, dataform: record.dataform, record: record._id, channel: wa ? 'whatsapp' : 'sms', direction: 'inbound',
      status: 'received', from, to: String(req.body.To ?? '').replace(/^whatsapp:/, ''), body: String(req.body.Body ?? '').slice(0, 10000), providerId: req.body.MessageSid,
    });
    await notifyFollowers(i, record, dataform, `New ${wa ? 'WhatsApp' : 'SMS'} from ${label(dataform, record)}`, i.body);
  }
  // Twilio expects TwiML; an empty response means "do not reply".
  res.type('text/xml').send('<Response/>');
});

router.post('/inbound-email/:integrationId', validate({ params: idParams }), async (req, res) => {
  const { doc } = await loadIntegration(req, 'smtp');
  const secret = doc.webhookSecret ? decrypt(doc.webhookSecret) : null;
  if (!secret || !safeEqual(req.get('x-webhook-secret') ?? '', secret)) throw forbidden('Invalid webhook secret');
  const body = z.object({ from: z.string().max(320), to: z.string().max(320).optional(), subject: z.string().max(300).default(''), text: z.string().max(100000).default(''), recordId: objectId.optional() }).safeParse(req.body);
  if (!body.success) throw badRequest('Invalid payload', body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const { from, to, subject, text, recordId } = body.data;

  let record = recordId ? await RecordModel.findOne({ _id: recordId, account: doc.account }).lean() : null;
  if (!record) {
    // Fall back to matching the sender's address against email fields.
    const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
    for (const f of await FieldDefinition.find({ account: doc.account, type: 'email' }).lean()) {
      record = await RecordModel.findOne({ account: doc.account, dataform: f.dataform, [`data.${f.key}`]: address }).lean();
      if (record) break;
    }
  }
  if (!record) return res.status(202).json({ matched: false });
  const dataform = await Dataform.findById(record.dataform);
  const i = await Interaction.create({
    account: doc.account, workspace: record.workspace, dataform: record.dataform, record: record._id, channel: 'email', direction: 'inbound',
    status: 'received', from, to, subject, body: text.slice(0, 10000),
  });
  await notifyFollowers(i, record, dataform, `New email from ${label(dataform, record)}`, `${subject}\n${text}`);
  res.status(201).json({ matched: true, interactionId: i._id });
});

export default router;
