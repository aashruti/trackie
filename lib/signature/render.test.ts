import { describe, expect, it } from "vitest";
import {
  COMPANY_NAME,
  DEFAULT_ACCENT,
  DEFAULT_ADDRESS,
  renderSignatureHtml,
  renderSignatureText,
  validateSignature,
  type SignatureFields,
} from "./render";

const fields: SignatureFields = {
  layout: "card",
  font: "sans",
  signOff: "",
  name: "Kunal Sharma",
  title: "Chief Technology Officer",
  company: COMPANY_NAME,
  extraLine: "",
  email: "kunal.sharma@datagami.in",
  phone: "+91 86901 49598",
  address: DEFAULT_ADDRESS,
  accentColor: DEFAULT_ACCENT,
  badge: "none",
  showEmail: true,
  showWebsite: true,
  showAddress: true,
  showEdudron: true,
};

// The academia-relations style: plain lines, a sign-off, a partner line and badge.
const plain: SignatureFields = {
  ...fields,
  layout: "plain",
  font: "serif",
  signOff: "Warm Regards",
  name: "Suresh K Sharma",
  title: "Head - Academia Relations",
  phone: "7738170621",
  company: "Datagami Technology Services Pvt. Ltd. (Mumbai)",
  extraLine: "Premium Business Partner - IBM ICE",
  email: "",
  badge: "ibm-ice",
  showEmail: false,
  showWebsite: false,
  showAddress: false,
  showEdudron: false,
};

describe("renderSignatureHtml", () => {
  it("renders every line of the standard signature", () => {
    const html = renderSignatureHtml(fields, "https://trackie.example/");
    expect(html).toContain("Kunal Sharma");
    expect(html).toContain("Chief Technology Officer");
    expect(html).toContain("Datagami Technology Services Pvt. Ltd");
    expect(html).toContain('href="mailto:kunal.sharma@datagami.in"');
    expect(html).toContain('href="tel:+918690149598"');
    expect(html).toContain("Saki Naka, Andheri East, Mumbai-400072");
    expect(html).toContain("edudron.com");
  });

  it("uses absolute image URLs without a doubled slash", () => {
    const html = renderSignatureHtml(fields, "https://trackie.example/");
    expect(html).toContain('src="https://trackie.example/signature/datagami-logo.png"');
    expect(html).toContain('src="https://trackie.example/signature/edudron-icon.png"');
  });

  it("escapes user text so it cannot inject markup", () => {
    const html = renderSignatureHtml(
      { ...fields, name: `<img src=x onerror="a()">`, title: `R&D "Lead"` },
      "https://t.example",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(html).toContain("R&amp;D &quot;Lead&quot;");
  });

  it("drops what the employee hid or left blank", () => {
    const html = renderSignatureHtml(
      { ...fields, phone: "", showAddress: false, showEdudron: false },
      "https://t.example",
    );
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("Saki Naka");
    expect(html).not.toContain("edudron");
  });

  it("falls back to the default accent for a colour outside the list", () => {
    const html = renderSignatureHtml({ ...fields, accentColor: "red;background:url(x)" }, "https://t.example");
    expect(html).not.toContain("url(x)");
    expect(html).toContain(DEFAULT_ACCENT);
  });
});

describe("classic Outlook safety", () => {
  const all = { ...fields, signOff: "Warm Regards", extraLine: "Partner", badge: "ibm-ice" };

  it.each(["card", "plain"])("sets the font on every text block in the %s layout", (layout) => {
    const html = renderSignatureHtml({ ...all, layout }, "https://t.example");
    const blocks = html.match(/<div style="[^"]*"/g) ?? [];
    expect(blocks.length).toBeGreaterThan(4);
    for (const block of blocks) expect(block).toContain("font-family:");
    expect(html).toMatch(/<td style="[^"]*font-family:[^"]*">Our flagship LMS/);
  });

  it.each(["card", "plain"])("uses no margins or div padding in the %s layout", (layout) => {
    const html = renderSignatureHtml({ ...all, layout }, "https://t.example");
    expect(html).not.toContain("margin");
    expect(html).not.toMatch(/<div style="[^"]*padding/);
  });
});

describe("phone numbers", () => {
  it.each([
    "(022) 2345 6789",
    "7738170621",
    "+91 86901 49598",
    "+91 98765 43210 / +91 91234 56789",
    "+91 98765 43210, 022 2345 6789",
    "+91 22 1234 5678 ext 12",
    "+91 22 1234 5678 x12",
  ])("accepts %s", (phone) => {
    expect(validateSignature({ ...fields, phone }).ok).toBe(true);
  });

  it.each(["call me", "12", "1 / 2 / 3", "98765 43210 / 91234 56789 / 90000 00000"])("rejects %s", (phone) => {
    expect(validateSignature({ ...fields, phone }).ok).toBe(false);
  });

  it("gives each of two numbers its own link", () => {
    const html = renderSignatureHtml({ ...fields, phone: "+91 98765 43210 / 022 2345 6789" }, "https://t.example");
    expect(html).toContain('href="tel:+919876543210"');
    expect(html).toContain('href="tel:02223456789"');
  });

  it("leaves the extension out of the link but keeps it in the text", () => {
    const html = renderSignatureHtml({ ...fields, phone: "+91 22 1234 5678 ext 12" }, "https://t.example");
    expect(html).toContain('href="tel:+912212345678"');
    expect(html).toContain("+91 22 1234 5678 ext 12</a>");
  });
});

describe("plain layout", () => {
  const html = renderSignatureHtml(plain, "https://t.example");

  it("renders the sign-off, partner line and badge, in order", () => {
    const order = ["Warm Regards", "Suresh K Sharma", "Head - Academia Relations", "(Mumbai)", "IBM ICE", "ibm-ice.png"];
    const positions = order.map((s) => html.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("puts title and phone on one line", () => {
    expect(html).toMatch(/Head - Academia Relations \| <a href="tel:7738170621"/);
  });

  it("has no logo, website, email or address", () => {
    expect(html).not.toContain("datagami-logo");
    expect(html).not.toContain("www.datagami.in");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("Saki Naka");
  });

  it("uses the chosen font", () => {
    expect(html).toContain("Times New Roman");
  });

  it("gives a matching plain-text version", () => {
    expect(renderSignatureText(plain)).toBe(
      [
        "Warm Regards",
        "Suresh K Sharma",
        "Head - Academia Relations | 7738170621",
        "Datagami Technology Services Pvt. Ltd. (Mumbai)",
        "Premium Business Partner - IBM ICE",
      ].join("\n"),
    );
  });

  it("is valid with a blank, hidden email", () => {
    expect(validateSignature(plain).ok).toBe(true);
  });
});

describe("custom lines in the logo layout", () => {
  it("shows the sign-off, company, extra line and badge", () => {
    const html = renderSignatureHtml(
      { ...fields, signOff: "Best", company: "Datagami (Pune)", extraLine: "Partner", badge: "ibm-ice" },
      "https://t.example",
    );
    expect(html).toContain("Best");
    expect(html).toContain("Datagami (Pune)");
    expect(html).toContain("Partner");
    expect(html).toContain("/signature/ibm-ice.png");
    expect(html).toContain("datagami-logo.png");
  });

  it("escapes the new free-text lines", () => {
    const html = renderSignatureHtml(
      { ...fields, signOff: "<b>x</b>", company: "<i>y</i>", extraLine: "<u>z</u>" },
      "https://t.example",
    );
    expect(html).not.toMatch(/<b>x|<i>y|<u>z/);
  });

  it("hides the email and website when turned off", () => {
    const html = renderSignatureHtml({ ...fields, showEmail: false, showWebsite: false }, "https://t.example");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain(">www.datagami.in<");
  });

  it("ignores a badge outside the list", () => {
    expect(renderSignatureHtml({ ...fields, badge: "../../evil" }, "https://t.example")).not.toContain("evil");
  });
});

describe("renderSignatureText", () => {
  it("leaves out hidden sections", () => {
    const text = renderSignatureText({ ...fields, showAddress: false, showEdudron: false });
    expect(text).toContain("kunal.sharma@datagami.in  |  +91 86901 49598");
    expect(text).not.toContain("Saki Naka");
    expect(text).not.toContain("edudron");
  });
});

describe("validateSignature", () => {
  it("accepts a complete signature and trims it", () => {
    const res = validateSignature({ ...fields, name: "  Kunal Sharma " });
    expect(res).toEqual({ ok: true, value: fields });
  });

  it("allows a blank phone", () => {
    expect(validateSignature({ ...fields, phone: "" }).ok).toBe(true);
  });

  it.each([
    ["name", { name: " " }],
    ["title", { title: "" }],
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "call me" }],
    ["accent", { accentColor: "#123456" }],
    ["company", { company: "" }],
    ["layout", { layout: "fancy" }],
    ["font", { font: "comic" }],
    ["badge", { badge: "other" }],
    ["shown blank email", { email: "", showEmail: true }],
    ["hidden malformed email", { email: "nope", showEmail: false }],
  ])("rejects a bad %s", (_label, patch) => {
    expect(validateSignature({ ...fields, ...patch }).ok).toBe(false);
  });
});
