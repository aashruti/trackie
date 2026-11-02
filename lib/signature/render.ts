import { escapeEmailHtml as esc } from "@/lib/email/escape";

// Pure signature model + renderer — shared by the builder (client), the save
// action (server) and tests, so it must stay free of DB and Next.js imports.

export const COMPANY_NAME = "Datagami Technology Services Pvt. Ltd";
export const WEBSITE = { label: "www.datagami.in", href: "https://www.datagami.in" };
export const LMS = { label: "edudron.com", href: "https://edudron.com" };
export const DEFAULT_ADDRESS =
  "309, Crescent Business Square, Khairani Road,\nSaki Naka, Andheri East, Mumbai-400072";

// Closed lists, not free text: these values are written straight into inline CSS
// and image URLs.
export const ACCENTS = [
  { label: "Datagami gold", value: "#F0B93A" },
  { label: "Navy", value: "#0F2540" },
  { label: "Blue", value: "#2563EB" },
  { label: "Teal", value: "#0F766E" },
] as const;
export const DEFAULT_ACCENT: string = ACCENTS[0].value;

export const LAYOUTS = [
  { label: "With logo", value: "card" },
  { label: "Plain", value: "plain" },
] as const;

export const FONTS = [
  { label: "Sans serif", value: "sans", css: "Arial,Helvetica,sans-serif" },
  { label: "Serif", value: "serif", css: "'Times New Roman',Times,serif" },
] as const;

export const BADGES = [
  { label: "None", value: "none" },
  {
    label: "IBM Innovation Center for Education",
    value: "ibm-ice",
    file: "ibm-ice.png",
    alt: "IBM Innovation Center for Education",
    width: 240,
    height: 77,
  },
] as const;

export type SignatureFields = {
  layout: string;
  font: string;
  signOff: string;
  name: string;
  title: string;
  company: string;
  extraLine: string;
  email: string;
  phone: string;
  address: string;
  accentColor: string;
  badge: string;
  showEmail: boolean;
  showWebsite: boolean;
  showAddress: boolean;
  showEdudron: boolean;
};

// One or two numbers split by "/" or ",", each with an optional extension:
// "(022) 2345 6789", "+91 98765 43210 / +91 91234 56789", "+91 22 1234 5678 ext 12".
const PHONE_SPLIT = /\s*[/,]\s*/;
const PHONE_EXTENSION = /\s*(?:ext\.?|x)\s*\d{1,6}$/i;
const PHONE_NUMBER = /^\+?\(?\d[\d\s().-]{5,24}$/;

function isValidPhone(phone: string): boolean {
  const numbers = phone.split(PHONE_SPLIT);
  return numbers.length <= 2 && numbers.every((n) => PHONE_NUMBER.test(n.replace(PHONE_EXTENSION, "")));
}

const inList = (list: readonly { value: string }[], value: string) =>
  list.some((item) => item.value === value);

export function validateSignature(
  input: SignatureFields,
): { ok: true; value: SignatureFields } | { ok: false; error: string } {
  const value: SignatureFields = {
    layout: String(input.layout ?? ""),
    font: String(input.font ?? ""),
    signOff: String(input.signOff ?? "").trim(),
    name: String(input.name ?? "").trim(),
    title: String(input.title ?? "").trim(),
    company: String(input.company ?? "").trim(),
    extraLine: String(input.extraLine ?? "").trim(),
    email: String(input.email ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    address: String(input.address ?? "").trim(),
    accentColor: String(input.accentColor ?? ""),
    badge: String(input.badge ?? ""),
    showEmail: input.showEmail === true,
    showWebsite: input.showWebsite === true,
    showAddress: input.showAddress === true,
    showEdudron: input.showEdudron === true,
  };
  if (value.signOff.length > 60) return { ok: false, error: "Sign-off is too long." };
  if (!value.name) return { ok: false, error: "Enter your name." };
  if (value.name.length > 80) return { ok: false, error: "Name is too long." };
  if (!value.title) return { ok: false, error: "Enter your title." };
  if (value.title.length > 100) return { ok: false, error: "Title is too long." };
  if (!value.company) return { ok: false, error: "Enter your company line." };
  if (value.company.length > 120) return { ok: false, error: "Company line is too long." };
  if (value.extraLine.length > 120) return { ok: false, error: "Extra line is too long." };
  // A hidden email may be blank, but anything entered must still be an address.
  if (value.showEmail && !value.email) return { ok: false, error: "Enter a valid email address." };
  if (value.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 120))
    return { ok: false, error: "Enter a valid email address." };
  if (value.phone && !isValidPhone(value.phone))
    return { ok: false, error: "Enter a valid phone number, or leave it blank." };
  if (value.address.length > 300) return { ok: false, error: "Address is too long." };
  if (!inList(LAYOUTS, value.layout)) return { ok: false, error: "Choose one of the listed layouts." };
  if (!inList(FONTS, value.font)) return { ok: false, error: "Choose one of the listed fonts." };
  if (!inList(ACCENTS, value.accentColor)) return { ok: false, error: "Choose one of the listed colours." };
  if (!inList(BADGES, value.badge)) return { ok: false, error: "Choose one of the listed badges." };
  return { ok: true, value };
}

const NAVY = "#0F2540";
const GREY = "#6B7280";
const LINK = "#2B6CB0";

const row = (html: string, style: string) => `<div style="${style}">${html}</div>`;
const lineBreaks = (s: string) => s.split(/\r?\n/).map(esc).join("<br>");
const mailLink = (email: string, color: string) =>
  `<a href="mailto:${esc(encodeURI(email))}" style="color:${color};text-decoration:none;">${esc(email)}</a>`;
const telLinks = (phone: string, color: string) =>
  phone
    .split(PHONE_SPLIT)
    .map(
      (n) =>
        `<a href="tel:${esc(n.replace(PHONE_EXTENSION, "").replace(/[^+\d]/g, ""))}" style="color:${color};text-decoration:none;white-space:nowrap;">${esc(n)}</a>`,
    )
    .join(" / ");
// Classic Outlook ignores margins here and padding on divs, so gaps are cell padding.
const spaced = (html: string, side: "top" | "bottom") =>
  `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="padding-${side}:8px;">${html}</td></tr></table>`;

function badgeImg(f: SignatureFields, base: string): string {
  const badge = BADGES.find((b) => b.value === f.badge);
  if (!badge || badge.value === "none") return "";
  return spaced(
    `<img src="${esc(base)}/signature/${badge.file}" width="${badge.width}" height="${badge.height}" alt="${esc(badge.alt)}" style="display:block;border:0;">`,
    "top",
  );
}

function lmsRow(base: string, font: string): string {
  return spaced(
    `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>` +
    `<td style="padding:8px 8px 0 0;vertical-align:middle;border-top:1px solid #E5E7EB;"><img src="${esc(base)}/signature/edudron-icon.png" width="20" height="28" alt="EduDron" style="display:block;border:0;"></td>` +
    `<td style="padding:8px 0 0 0;vertical-align:middle;border-top:1px solid #E5E7EB;${font}font-size:12px;line-height:18px;color:${GREY};">Our flagship LMS platform&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${LMS.href}" style="color:${LINK};text-decoration:none;font-weight:bold;">${LMS.label}</a></td>` +
    `</tr></table>`,
    "top",
  );
}

// Each text block sets its own font: classic Outlook doesn't reliably inherit it.
function renderCard(f: SignatureFields, base: string, font: string): string {
  const accent = inList(ACCENTS, f.accentColor) ? f.accentColor : DEFAULT_ACCENT;
  const contact = [
    f.showEmail && f.email && mailLink(f.email, GREY),
    f.phone && telLinks(f.phone, LINK),
  ]
    .filter(Boolean)
    .join("&nbsp;&nbsp;|&nbsp;&nbsp;");

  const lines = [
    row(esc(f.name), `${font}font-size:20px;line-height:26px;font-weight:bold;color:${NAVY};`),
    f.title && row(esc(f.title), `${font}font-size:14px;line-height:22px;font-weight:bold;color:${accent};`),
    f.company && row(esc(f.company), `${font}font-size:14px;line-height:24px;font-weight:bold;color:${NAVY};`),
    f.extraLine && row(esc(f.extraLine), `${font}font-size:13px;line-height:20px;font-weight:bold;color:${NAVY};`),
    contact && row(contact, `${font}font-size:13px;line-height:22px;color:${GREY};`),
    f.showWebsite &&
      row(
        `<a href="${WEBSITE.href}" style="color:${LINK};text-decoration:none;font-weight:bold;">${WEBSITE.label}</a>`,
        `${font}font-size:13px;line-height:22px;`,
      ),
    f.showAddress && f.address &&
      row(lineBreaks(f.address), `${font}font-size:12px;line-height:18px;color:${GREY};`),
  ]
    .filter(Boolean)
    .join("");

  return (
    `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>` +
    `<td style="padding:0 20px 0 0;vertical-align:middle;"><a href="${WEBSITE.href}"><img src="${esc(base)}/signature/datagami-logo.png" width="140" height="81" alt="Datagami" style="display:block;border:0;"></a></td>` +
    `<td width="3" bgcolor="${accent}" style="width:3px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="padding:0 0 0 20px;vertical-align:top;">${lines}${badgeImg(f, base)}${f.showEdudron ? lmsRow(base, font) : ""}</td>` +
    `</tr></table>`
  );
}

// Plain stacked bold lines with no logo: "Title | phone" share a line.
function renderPlain(f: SignatureFields, base: string, font: string): string {
  const style = `${font}font-size:15px;line-height:24px;font-weight:bold;color:#111111;`;
  const titleLine = [f.title && esc(f.title), f.phone && telLinks(f.phone, "#111111")]
    .filter(Boolean)
    .join(" | ");
  const lines = [
    row(esc(f.name), style),
    titleLine && row(titleLine, style),
    f.company && row(esc(f.company), style),
    f.extraLine && row(esc(f.extraLine), style),
    f.showEmail && f.email && row(mailLink(f.email, "#111111"), style),
    f.showWebsite &&
      row(`<a href="${WEBSITE.href}" style="color:#111111;text-decoration:none;">${WEBSITE.label}</a>`, style),
    f.showAddress && f.address && row(lineBreaks(f.address), style),
  ]
    .filter(Boolean)
    .join("");
  return `${lines}${badgeImg(f, base)}${f.showEdudron ? lmsRow(base, font) : ""}`;
}

/**
 * Email-client HTML: nested tables and inline styles only, because Gmail and
 * Outlook strip stylesheets and Outlook ignores flexbox. Images need an absolute
 * public URL (`assetBase`) — the recipient's mail client fetches them.
 */
export function renderSignatureHtml(f: SignatureFields, assetBase: string): string {
  const base = assetBase.replace(/\/+$/, "");
  const font = `font-family:${(FONTS.find((x) => x.value === f.font) ?? FONTS[0]).css};`;
  const signOff = f.signOff
    ? spaced(
        row(esc(f.signOff), `${font}font-size:15px;line-height:24px;font-weight:bold;color:${f.layout === "plain" ? "#111111" : NAVY};`),
        "bottom",
      )
    : "";
  return signOff + (f.layout === "plain" ? renderPlain(f, base, font) : renderCard(f, base, font));
}

export function renderSignatureText(f: SignatureFields): string {
  const email = f.showEmail ? f.email : "";
  const titlePhone = f.layout === "plain" ? [f.title, f.phone].filter(Boolean).join(" | ") : f.title;
  return [
    f.signOff,
    f.name,
    titlePhone,
    f.company,
    f.extraLine,
    f.layout === "plain" ? email : [email, f.phone].filter(Boolean).join("  |  "),
    f.showWebsite ? WEBSITE.label : "",
    f.showAddress ? f.address : "",
    f.showEdudron ? `Our flagship LMS platform · ${LMS.label}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
