import "server-only";

import { sendEmail } from "./notify";
import { brandedEmail, emailButton, escapeEmailHtml as esc } from "./brand";

/** Send the "confirm your email" message with a verification link. */
export async function sendVerificationEmail(to: string, name: string, link: string) {
  const html = brandedEmail({
    preheader: "Confirm your email address for Trackie.",
    eyebrow: "Account security",
    title: "Verify your email",
    body: `<p style="margin:0">Hi <strong>${esc(name)}</strong>, confirm this address to receive Trackie notifications and account updates.</p>
      ${emailButton(link, "Verify email address")}
      <p style="margin:16px 0 0;color:#64748B;font-size:12px;line-height:19px">This secure link expires in 24 hours. If the button doesn’t work, copy and paste this URL into your browser:<br><span style="word-break:break-all;color:#475569">${esc(link)}</span></p>`,
  });
  return sendEmail({
    to,
    subject: "Verify your email for Trackie",
    html,
    text: `Hi ${name}, verify your email for Trackie: ${link} (expires in 24h).`,
  });
}
