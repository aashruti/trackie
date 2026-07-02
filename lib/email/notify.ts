import "server-only";

import { EmailClient } from "@azure/communication-email";

/**
 * Transactional email via Azure Communication Services (ACS).
 *
 * Graceful fallback: when ACS_CONNECTION_STRING is absent (e.g. before the env
 * var is added to the Vercel project) this logs the email and returns
 * { sent: false } instead of throwing — so notification-triggering actions
 * (leave approvals, etc.) never fail just because email isn't wired in that
 * environment. Locally .env.local carries the real connection string, so sends
 * work in dev immediately.
 *
 * Resources (RG datagami-trackie): ACS `trackie-acs`, Email service
 * `trackie-email`, Azure-managed domain (sender DoNotReply@<...>.azurecomm.net).
 */
export type EmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type EmailResult = { sent: boolean; id?: string; skippedReason?: string };

let cached: EmailClient | null = null;
function client(): EmailClient | null {
  const cs = process.env.ACS_CONNECTION_STRING;
  if (!cs) return null;
  if (!cached) cached = new EmailClient(cs);
  return cached;
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const sender = process.env.ACS_SENDER_ADDRESS;
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const c = client();

  if (!c || !sender) {
    console.info(
      `[email:skipped] ACS not configured — would send "${input.subject}" to ${to.join(", ")}`,
    );
    return { sent: false, skippedReason: "acs-not-configured" };
  }

  try {
    const poller = await c.beginSend({
      senderAddress: sender,
      content: {
        subject: input.subject,
        html: input.html,
        plainText: input.text,
      },
      recipients: { to: to.map((address) => ({ address })) },
      replyTo: input.replyTo ? [{ address: input.replyTo }] : undefined,
    });
    const result = await poller.pollUntilDone();
    return { sent: result.status === "Succeeded", id: result.id };
  } catch (e) {
    // Never let a notification failure break the triggering action.
    console.error("[email:error]", e instanceof Error ? e.message : e);
    return { sent: false, skippedReason: "exception" };
  }
}
