import "server-only";

const GOLD = "#E5A50A";
const INK = "#0F172A";
const MUTED = "#64748B";
const CANVAS = "#F8FAFC";
const BORDER = "#E2E8F0";

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px">
    <tr>
      <td bgcolor="${GOLD}" style="border-radius:8px">
        <a href="${escapeEmailHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:Arial,sans-serif;font-size:14px;line-height:18px;font-weight:700;color:#020617;text-decoration:none;border-radius:8px">${escapeEmailHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export function emailDetailTable(rows: { label: string; value: string }[]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;background:#F8FAFC;border:1px solid ${BORDER};border-radius:10px">
    ${rows.map((row, index) => `<tr>
      <td style="padding:${index === 0 ? "14px" : "10px"} 16px ${index === rows.length - 1 ? "14px" : "10px"};font-family:Arial,sans-serif;font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${MUTED};${index ? `border-top:1px solid ${BORDER};` : ""}">${escapeEmailHtml(row.label)}</td>
      <td align="right" style="padding:${index === 0 ? "14px" : "10px"} 16px ${index === rows.length - 1 ? "14px" : "10px"};font-family:Arial,sans-serif;font-size:14px;line-height:20px;font-weight:600;color:${INK};${index ? `border-top:1px solid ${BORDER};` : ""}">${escapeEmailHtml(row.value)}</td>
    </tr>`).join("")}
  </table>`;
}

export function brandedEmail({
  preheader,
  eyebrow,
  title,
  body,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeEmailHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${CANVAS};color:${INK}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeEmailHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${CANVAS}">
      <tr>
        <td align="center" style="padding:28px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
            <tr>
              <td style="background:${INK};border-radius:14px 14px 0 0;border-top:4px solid ${GOLD};padding:22px 28px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="42" height="42" align="center" valign="middle" bgcolor="${GOLD}" style="width:42px;height:42px;border-radius:10px;font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:#020617">T</td>
                    <td style="padding-left:13px">
                      <div style="font-family:Arial,sans-serif;font-size:19px;line-height:22px;font-weight:800;letter-spacing:.12em;color:#FFFFFF">TRACKIE</div>
                      <div style="margin-top:3px;font-family:Arial,sans-serif;font-size:11px;line-height:14px;letter-spacing:.08em;text-transform:uppercase;color:#CBD5E1">Datagami</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#FFFFFF;border:1px solid ${BORDER};border-top:0;padding:30px 28px">
                <div style="font-family:Arial,sans-serif;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#A16207">${escapeEmailHtml(eyebrow)}</div>
                <h1 style="margin:7px 0 18px;font-family:Arial,sans-serif;font-size:24px;line-height:31px;font-weight:750;color:${INK}">${escapeEmailHtml(title)}</h1>
                <div style="font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155">${body}</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="background:#F1F5F9;border:1px solid ${BORDER};border-top:0;border-radius:0 0 14px 14px;padding:18px 24px;font-family:Arial,sans-serif;font-size:11px;line-height:17px;color:${MUTED}">
                Sent by <strong style="color:${INK}">Trackie</strong> · Datagami<br>
                This is an automated notification.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
