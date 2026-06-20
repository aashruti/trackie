"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addLeadAction } from "@/app/(app)/leads/actions";
import { PEOPLE } from "@/lib/board/constants";
import { fmtCompact } from "@/lib/money/format";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

const OEMS = ["IBM", "AAFM"];

export function NewLeadDialog({ defaultOwner, onClose }: { defaultOwner: string; onClose: () => void }) {
  const ownerKeys = Object.keys(PEOPLE);
  const [prospect, setProspect] = useState("");
  const [city, setCity] = useState("");
  const [oem, setOem] = useState(OEMS[0]);
  const [owner, setOwner] = useState(ownerKeys.includes(defaultOwner) ? defaultOwner : ownerKeys[0]);
  const [students, setStudents] = useState("");
  const [priceToUni, setPriceToUni] = useState("");
  const [priceToDatagami, setPriceToDatagami] = useState("");
  const [source, setSource] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nStudents = Number(students.replace(/[^0-9]/g, "")) || 0;
  const pUni = Number(priceToUni.replace(/[^0-9.]/g, "")) || 0;
  const pDg = Number(priceToDatagami.replace(/[^0-9.]/g, "")) || 0;
  const estValue = nStudents * pUni;
  const estMargin = nStudents * (pUni - pDg);

  function submit() {
    setError(null);
    if (!prospect.trim()) {
      setError("Prospect name is required.");
      return;
    }
    startTransition(async () => {
      try {
        await addLeadAction({
          prospect: prospect.trim(),
          city: city.trim() || null,
          oem,
          owner,
          students: nStudents,
          priceToUni: pUni,
          priceToDatagami: pDg,
          source: source.trim() || null,
          nextAction: nextAction.trim() || null,
          nextDate: nextDate || null,
          contactName: contactName.trim() || null,
          contactRole: contactRole.trim() || null,
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create lead");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-lead-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[5vh] w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="new-lead-title" className="text-base font-bold tracking-tight text-text-primary">
            Add lead
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-muted hover:bg-surface-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Prospect</span>
            <input autoFocus value={prospect} onChange={(e) => setProspect(e.target.value)} placeholder="e.g. Bennett University" className={fieldCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Greater Noida, UP" className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">OEM interest</span>
              <select value={oem} onChange={(e) => setOem(e.target.value)} className={fieldCls}>
                {OEMS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Owner</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={fieldCls}>
                {ownerKeys.map((k) => <option key={k} value={k}>{PEOPLE[k].name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Students</span>
              <input value={students} onChange={(e) => setStudents(e.target.value)} inputMode="numeric" placeholder="e.g. 1150" className={`tabular ${fieldCls}`} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Price / seat (₹)</span>
              <input value={priceToUni} onChange={(e) => setPriceToUni(e.target.value)} inputMode="numeric" placeholder="e.g. 8000" className={`tabular ${fieldCls}`} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Transfer price / seat (₹)</span>
              <input value={priceToDatagami} onChange={(e) => setPriceToDatagami(e.target.value)} inputMode="numeric" placeholder="e.g. 6800" className={`tabular ${fieldCls}`} />
            </label>
            <div className="col-span-2 self-end">
              <div className="flex items-center justify-around rounded-md border border-border bg-surface-sunken px-3 py-2 text-center">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Est. value</div>
                  <div className="tabular text-sm font-bold text-text-primary">{fmtCompact(estValue)}</div>
                </div>
                <div className="h-7 w-px bg-border-subtle" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Est. margin</div>
                  <div className="tabular text-sm font-bold" style={{ color: estMargin < 0 ? "var(--negative-text)" : "var(--positive-text)" }}>
                    {fmtCompact(estMargin)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Source</span>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Referral · Amity" className={fieldCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Next action</span>
              <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Send proposal" className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Next date</span>
              <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={fieldCls} />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-surface-sunken p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">Primary contact</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">Name</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">Role</span>
                <input value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="e.g. Registrar" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">Email</span>
                <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} type="email" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">Phone</span>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={fieldCls} />
              </label>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
            Cancel
          </button>
          <button onClick={submit} disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
            {pending ? "Creating…" : "Add lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
