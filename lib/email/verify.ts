import "server-only";

import { sendEmail } from "./notify";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Send the "confirm your email" message with a verification link. */
export async function sendVerificationEmail(to: string, name: string, link: string) {
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;line-height:1.5">
    <h2 style="margin:0 0 8px">Verify your email</h2>
    <p>Hi ${esc(name)}, confirm this address to receive Trackie notifications (leave approvals, etc.).</p>
    <p style="margin:16px 0">
      <a href="${link}" style="display:inline-block;background:#E5A50A;color:#020617;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">Verify email</a>
    </p>
    <p style="color:#64748B;font-size:12px">This link expires in 24 hours. If the button doesn't work, paste this URL into your browser:<br>${esc(link)}</p>
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0"/>
    <p style="color:#64748B;font-size:12px">Trackie · Datagami</p>
  </div>`;
  return sendEmail({
    to,
    subject: "Verify your email for Trackie",
    html,
    text: `Hi ${name}, verify your email for Trackie: ${link} (expires in 24h).`,
  });
}
