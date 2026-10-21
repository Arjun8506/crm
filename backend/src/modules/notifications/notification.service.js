import { env } from "../../config/env.js";
import { emailConfigured, getMailer } from "../../providers/email.js";
import { emitUser } from "../../sockets/index.js";
import { User } from "../users/user.model.js";
import { Notification } from "./notification.model.js";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Creates in-app notifications (respecting each user's preferences), pushes them over the socket, and
// sends email only to users who opted in AND only when a mail transport is configured.
export async function notify({
  account,
  recipients,
  actor,
  type,
  title,
  body = "",
  link = "",
}) {
  const ids = [...new Set(recipients.map(String))].filter(
    (id) => id !== String(actor),
  );
  if (ids.length === 0) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select("email name preferences")
    .lean();

  const inApp = users.filter(
    (u) => u.preferences?.notifications?.inApp?.[type] !== false,
  );
  const docs = inApp.length
    ? await Notification.insertMany(
        inApp.map((u) => ({
          account,
          user: u._id,
          actor,
          type,
          title: title.slice(0, 200),
          body: body.slice(0, 300),
          link,
        })),
      )
    : [];
  for (const d of docs)
    emitUser(d.user, "notification.new", { id: String(d._id), type });

  if (emailConfigured()) {
    const mailer = getMailer();
    for (const u of users.filter(
      (x) => x.preferences?.notifications?.email?.[type] === true,
    )) {
      mailer
        .send({
          to: u.email,
          subject: title,
          text: `${title}\n\n${body}\n\n${env.APP_URL}${link}`,
          html: `<p><b>${escapeHtml(title)}</b></p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(env.APP_URL + link)}">Open in OrgCRM</a></p>`,
        })
        .catch((err) =>
          console.error(
            `[email] delivery to ${u.email} failed: ${err.message}`,
          ),
        );
    }
  }
  return docs;
}
