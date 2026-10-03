import "server-only";

import type { NotificationChannel, OutgoingNotification, Recipient } from "./channels";

const RESEND_URL = "https://api.resend.com/emails";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** The email for one notification: its title and text, and a link that opens it after signing in. */
export function renderEmail(notification: OutgoingNotification, recipient: Recipient, appUrl: string) {
  const link = new URL(`/notifications/go/${notification.id}`, appUrl).toString();
  const greeting = recipient.fullName ? `Hi ${recipient.fullName.split(" ")[0]},` : "Hi,";
  const footer = "You get these emails because you have a Concierge by 6IX account.";
  const text = [
    greeting,
    "",
    notification.title,
    notification.body ?? "",
    "",
    `Open in Concierge: ${link}`,
    "",
    footer,
  ]
    .filter((line, i, lines) => !(line === "" && lines[i - 1] === ""))
    .join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1a">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 8px;font-size:18px;font-weight:600">${escapeHtml(notification.title)}</p>
${notification.body ? `<p style="margin:0 0 20px;line-height:1.5">${escapeHtml(notification.body)}</p>` : ""}
<a href="${escapeHtml(link)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Open in Concierge</a>
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#6b6b66">${escapeHtml(footer)}</p>
</body></html>`;
  return { subject: notification.title, text, html };
}

/**
 * Email through Resend's API. The key stays on the server; the sender address must be on a domain
 * verified in Resend (see docs/deployment.md).
 */
export function createResendChannel(options: {
  apiKey: string;
  from: string;
  appUrl: string;
  fetch?: typeof fetch;
}): NotificationChannel {
  const send = options.fetch ?? fetch;
  return {
    name: "email",
    async send(notification, recipient) {
      if (!recipient.email) throw new Error("No email address");
      const { subject, text, html } = renderEmail(notification, recipient, options.appUrl);
      const response = await send(RESEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          // Resend drops a repeat with the same key, so a retry after a timeout sends one email.
          "idempotency-key": `notification-${notification.id}`,
        },
        body: JSON.stringify({ from: options.from, to: [recipient.email], subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      });
      // Never include the response body: it can echo the address.
      if (!response.ok) throw new Error(`Email provider answered ${response.status}`);
    },
  };
}
