"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { saveSignatureAction } from "@/app/(app)/me/signature/actions";
import { Field, FormMessage, INPUT_CLASS as INPUT } from "@/components/ui/form";
import {
  ACCENTS,
  BADGES,
  FONTS,
  LAYOUTS,
  renderSignatureHtml,
  renderSignatureText,
  validateSignature,
  type SignatureFields,
} from "@/lib/signature/render";

type Msg = { ok: boolean; text: string };

export function SignatureBuilder({
  initial,
  defaults,
  saved,
  assetBase,
  testEnvironment,
}: {
  initial: SignatureFields;
  defaults: SignatureFields;
  saved: boolean;
  assetBase: string;
  testEnvironment: boolean;
}) {
  const [f, setF] = useState(initial);
  const [lastSaved, setLastSaved] = useState(saved ? initial : null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [isPending, startTransition] = useTransition();
  const previewRef = useRef<HTMLDivElement>(null);

  // Every user-entered value is escaped by the renderer (see render.test.ts), so
  // this is safe to inject into the preview.
  const html = useMemo(() => renderSignatureHtml(f, assetBase), [f, assetBase]);
  const dirty = !lastSaved || JSON.stringify(lastSaved) !== JSON.stringify(f);

  function set<K extends keyof SignatureFields>(key: K, value: SignatureFields[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
    setMsg(null);
  }

  // Switching layout also sets sensible show/hide choices for it. Anything typed
  // is kept, and each choice can still be changed afterwards.
  function chooseLayout(layout: string) {
    if (layout === f.layout) return;
    const shown = layout !== "plain";
    setF((prev) => ({
      ...prev,
      layout,
      showEmail: shown,
      showWebsite: shown,
      showAddress: shown,
      showEdudron: shown,
    }));
    setMsg(null);
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await saveSignatureAction(f);
        if (res.ok) {
          setLastSaved(f);
          setMsg({ ok: true, text: "Signature saved." });
        } else {
          setMsg({ ok: false, text: res.error });
        }
      } catch {
        // A rejected action would otherwise reach the error page and lose the draft.
        setMsg({ ok: false, text: "Could not save. Your edits are still here, so please try again." });
      }
    });
  }

  // Copying skips Save, so it needs its own check: a signature with no name or a
  // broken phone link would otherwise go straight into someone's mail settings.
  function canCopy(): boolean {
    const check = validateSignature(f);
    if (!check.ok) setMsg({ ok: false, text: check.error });
    return check.ok;
  }

  async function copySignature() {
    if (!canCopy()) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([renderSignatureText(f)], { type: "text/plain" }),
        }),
      ]);
      setMsg({ ok: true, text: "Copied. Paste it into your email signature settings." });
    } catch {
      // Older browsers have no rich clipboard API: copy the rendered preview instead.
      const selection = window.getSelection();
      if (previewRef.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(previewRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
        const copied = document.execCommand("copy");
        selection.removeAllRanges();
        setMsg(
          copied
            ? { ok: true, text: "Copied. Paste it into your email signature settings." }
            : { ok: false, text: "Could not copy. Select the preview and copy it by hand." },
        );
      }
    }
  }

  async function copySource() {
    if (!canCopy()) return;
    try {
      await navigator.clipboard.writeText(html);
      setMsg({ ok: true, text: "HTML source copied." });
    } catch {
      setMsg({ ok: false, text: "Could not copy the HTML source." });
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="mb-1 text-[15px] font-semibold text-text-primary">Your details</h2>
        <p className="mb-5 text-[12px] text-text-muted">
          Only your signature changes. Your HR record stays as it is.
        </p>
        <div className="flex flex-col gap-4">
          <Field label="Full name">
            <input className={INPUT} value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Title / role">
            <input
              className={INPUT}
              value={f.title}
              maxLength={100}
              placeholder="e.g. Chief Technology Officer"
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Company line">
            <input className={INPUT} value={f.company} maxLength={120} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" className={INPUT} value={f.email} maxLength={120} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone (optional)">
            <input
              type="tel"
              className={INPUT}
              value={f.phone}
              maxLength={60}
              placeholder="+91 98765 43210"
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>

          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-[13px] font-semibold text-text-primary">Customise</h3>
            <div className="flex flex-col gap-4">
              <Pills label="Layout" options={LAYOUTS} value={f.layout} onChange={chooseLayout} />
              <Pills label="Font" options={FONTS} value={f.font} onChange={(v) => set("font", v)} />
              {f.layout === "card" && (
                <Pills
                  label="Accent colour"
                  options={ACCENTS}
                  value={f.accentColor}
                  onChange={(v) => set("accentColor", v)}
                  swatches
                />
              )}
              <Field label="Sign-off (optional)">
                <input
                  className={INPUT}
                  value={f.signOff}
                  maxLength={60}
                  placeholder="e.g. Warm Regards"
                  onChange={(e) => set("signOff", e.target.value)}
                />
              </Field>
              <Field label="Extra line (optional)">
                <input
                  className={INPUT}
                  value={f.extraLine}
                  maxLength={120}
                  placeholder="e.g. Premium Business Partner - IBM ICE"
                  onChange={(e) => set("extraLine", e.target.value)}
                />
              </Field>
              <Field label="Partner badge">
                <select className={INPUT} value={f.badge} onChange={(e) => set("badge", e.target.value)}>
                  {BADGES.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </Field>
              <Toggle label="Show email" checked={f.showEmail} onChange={(v) => set("showEmail", v)} />
              <Toggle label="Show website" checked={f.showWebsite} onChange={(v) => set("showWebsite", v)} />
              <Toggle label="Show office address" checked={f.showAddress} onChange={(v) => set("showAddress", v)} />
              {f.showAddress && (
                <Field label="Office address">
                  <textarea
                    rows={2}
                    className={INPUT}
                    value={f.address}
                    maxLength={300}
                    onChange={(e) => set("address", e.target.value)}
                  />
                </Field>
              )}
              <Toggle label="Show EduDron line" checked={f.showEdudron} onChange={(v) => set("showEdudron", v)} />
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={save}
              disabled={isPending || !dirty}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
            <button
              type="button"
              onClick={() => { setF(defaults); setMsg(null); }}
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Reset to default
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-5">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-text-primary">Preview</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copySource}
                className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                Copy HTML source
              </button>
              <button
                type="button"
                onClick={copySignature}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-white"
              >
                Copy signature
              </button>
            </div>
          </div>
          {/* Always white: most recipients read mail on white, even in Trackie's dark theme. */}
          <div className="overflow-x-auto rounded-lg border border-border bg-white p-5">
            <div ref={previewRef} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {msg && <div className="mt-3"><FormMessage ok={msg.ok}>{msg.text}</FormMessage></div>}
          {testEnvironment && (
            <p className="mt-3 text-[12px] text-text-muted">
              This is a test copy of Trackie, so copied logos point to it and may not load for recipients. Copy from the live Trackie site instead.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-[15px] font-semibold text-text-primary">Add it to your email</h2>
          <dl className="space-y-3 text-[13px] text-text-secondary">
            <Step name="Gmail">Settings → See all settings → General → Signature → Create new, then paste and save.</Step>
            <Step name="Outlook on the web and new Outlook">Settings → Accounts → Signatures → New signature, then paste and save.</Step>
            <Step name="Classic Outlook">File → Options → Mail → Signatures → New, then paste and click OK.</Step>
          </dl>
        </div>
      </section>
    </div>
  );
}

// A group, not a <label>: a label wrapping buttons forwards clicks on its text to the first one.
function Pills({
  label,
  options,
  value,
  onChange,
  swatches = false,
}: {
  label: string;
  options: readonly { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  swatches?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium text-text-secondary ${
              value === o.value ? "border-[var(--primary)] bg-[var(--primary-subtle)]" : "border-border hover:bg-surface-hover"
            }`}
          >
            {swatches && <span className="h-3 w-3 rounded-full" style={{ background: o.value }} />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-text-primary">{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}
