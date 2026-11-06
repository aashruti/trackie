"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Money } from "@/components/ui/money";
import { useAppDialog } from "@/components/ui/app-dialog";
import type { ProgramDetail } from "@/lib/dal/delivery/programs";
import type { ProgramFileRow, ProgramPayment } from "@/lib/dal/delivery/po";
import { DEFAULT_GST_RATE, parseMoneyInput } from "@/lib/delivery/po-status";
import { MAX_FILE_BYTES } from "@/lib/delivery/upload-rules";
import { PAYMENT_STATUS_META } from "./meta";
import {
  addPaymentAction,
  deletePaymentAction,
  deleteProgramFileAction,
  updatePaymentAction,
  updateProgramPoAction,
} from "@/app/(app)/delivery/programs/[id]/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";
const ghostBtn =
  "rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40";
const dangerBtn =
  "rounded-md border border-[var(--negative-border)] px-2 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-40";
const errCls =
  "rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]";

type RunResult = { ok: boolean; error?: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Upload one file to the PO files route. Never throws: the route can answer
 * with a non-JSON body (a platform-level rejection before it runs), so every
 * failure path maps to a plain message.
 */
async function uploadProgramFile(
  programId: number,
  file: File,
  paymentId?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "That file is too large (max 4 MB)" };
  const body = new FormData();
  body.append("file", file);
  if (paymentId !== undefined) body.append("paymentId", String(paymentId));
  let res: Response;
  try {
    res = await fetch(`/api/delivery/programs/${programId}/files`, { method: "POST", body });
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, error: "Your session expired. Sign in again, then retry the upload." };
  if (res.status === 413) return { ok: false, error: "That file is too large (max 4 MB)" };
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return { ok: false, error: data.error };
  } catch {
    // Non-JSON body: fall through to the generic message.
  }
  return { ok: false, error: `The upload failed (error ${res.status}). Try again.` };
}

function FileLink({ file }: { file: ProgramFileRow }) {
  return (
    <a
      href={`/api/delivery/files/${file.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="truncate text-xs font-medium text-[var(--primary-text)] underline-offset-2 hover:underline"
    >
      {file.fileName}
    </a>
  );
}

/** A hidden file input behind a button; reports the chosen file and resets itself. */
function UploadButton({
  label,
  busy,
  disabled,
  onFile,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button type="button" onClick={() => ref.current?.click()} disabled={disabled || busy} className={ghostBtn}>
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}

export function PoPanel({
  detail,
  vendors,
  storageConfigured,
  canManage,
}: {
  detail: ProgramDetail;
  /** Active vendors, plus this PO's current vendor even if it is inactive. */
  vendors: { id: number; name: string }[];
  storageConfigured: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const { confirmAction } = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: number; name: string }[]>([]);
  const [editingPo, setEditingPo] = useState(false);
  const [paymentForm, setPaymentForm] = useState<"new" | number | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  function run(fn: () => Promise<RunResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return; }
      onOk?.();
      router.refresh();
    });
  }

  async function upload(key: string, file: File, paymentId?: number) {
    setError(null);
    setUploadingKey(key);
    const res = await uploadProgramFile(detail.id, file, paymentId);
    setUploadingKey(null);
    if (!res.ok) { setError(res.error); return; }
    router.refresh();
  }

  async function removeFile(file: ProgramFileRow) {
    const confirmed = await confirmAction({
      title: `Delete “${file.fileName}”?`,
      description: "The file will be permanently removed.",
      confirmLabel: "Delete file",
      tone: "danger",
    });
    if (confirmed) run(() => deleteProgramFileAction(detail.id, file.id));
  }

  const statusMeta = PAYMENT_STATUS_META[detail.po.status];
  const received = detail.payments.reduce((s, p) => s + p.amount, 0);
  const tds = detail.payments.reduce((s, p) => s + p.tds, 0);
  const budgetGap = detail.poValue === null ? null : detail.allocated - detail.poValue;
  const uploadNote = (
    <p className="text-xs text-text-muted">
      File uploads are not set up yet. Ask an admin to configure file storage. PO details and payments can still be saved.
    </p>
  );

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
          {error}
        </p>
      )}

      {/* Purchase order */}
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-text-primary">Purchase order</h2>
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: statusMeta.bg, color: statusMeta.text, borderColor: statusMeta.border }}
            >
              {statusMeta.label}
            </span>
          </div>
          {canManage && !editingPo && (
            <button onClick={() => setEditingPo(true)} disabled={pending} className={ghostBtn}>
              Edit PO details
            </button>
          )}
        </div>

        {duplicates.length > 0 && (
          <div className="mx-4 mt-3 rounded-md border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-3 py-2 text-xs text-[var(--pending-text)]">
            Saved. The same PO number is also on{" "}
            {duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/delivery/programs/${d.id}`} className="font-semibold underline">
                  {d.name}
                </Link>
              </span>
            ))}{" "}
            for this account and provider. Check it is not a duplicate.
          </div>
        )}

        {editingPo ? (
          <PoForm
            detail={detail}
            vendors={vendors}
            pending={pending}
            onCancel={() => setEditingPo(false)}
            onSave={(input) => {
              setError(null);
              startTransition(async () => {
                const res = await updateProgramPoAction(detail.id, input);
                if (!res.ok) { setError(res.error); return; }
                setDuplicates(res.duplicates);
                setEditingPo(false);
                router.refresh();
              });
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <Field label="PO number" value={detail.poNumber ?? "—"} />
            <Field label="PO date" value={detail.poDate ? fmtDate(detail.poDate) : "—"} />
            <Field label="Vendor" value={detail.vendorName ?? "—"} />
            <div>
              <dt className="text-[11px] font-medium text-text-muted">PO value (before GST)</dt>
              <dd className="mt-0.5 font-semibold text-text-primary">
                {detail.poValue === null ? "—" : <Money value={detail.poValue} />}
              </dd>
            </div>
            <Field label="GST rate" value={`${detail.gstRate}%`} />
          </dl>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 border-t border-border-subtle px-4 py-3 lg:grid-cols-4">
          <Stat label="Amount due (incl. GST)" value={detail.po.due} />
          <Stat label="Received" value={received} />
          <Stat label="TDS deducted" value={tds} />
          <Stat label="Outstanding" value={detail.po.outstanding} />
        </div>
        <div className="border-t border-border-subtle px-4 py-3 text-xs text-text-muted">
          {detail.poValue === null ? (
            <>Event budgets total <Money value={detail.allocated} className="font-semibold" />. Add a PO value to compare.</>
          ) : (
            <>
              PO value <Money value={detail.poValue} className="font-semibold" /> · Event budgets{" "}
              <Money value={detail.allocated} className="font-semibold" /> ·{" "}
              {budgetGap !== null && budgetGap > 0 ? (
                <span className="rounded-md bg-[var(--negative-subtle)] px-1.5 py-0.5 font-semibold text-[var(--negative-text)]">
                  Budgets exceed the PO value by <Money value={budgetGap} tone="negative" />
                </span>
              ) : (
                <span>
                  <Money value={Math.abs(budgetGap ?? 0)} className="font-semibold" /> of the PO value is not yet budgeted
                </span>
              )}
            </>
          )}
        </div>

        {/* Documents */}
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-text-secondary">PO documents · {detail.documents.length}</h3>
            {canManage && storageConfigured && (
              <UploadButton
                label="Add document"
                busy={uploadingKey === "doc"}
                disabled={pending || uploadingKey !== null}
                onFile={(f) => upload("doc", f)}
              />
            )}
          </div>
          {canManage && !storageConfigured && <div className="mt-2">{uploadNote}</div>}
          {detail.documents.length === 0 ? (
            <p className="mt-2 text-xs text-text-muted">No documents attached.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {detail.documents.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-sunken/50 px-3 py-1.5">
                  <FileLink file={f} />
                  {canManage && (
                    <button onClick={() => removeFile(f)} disabled={pending} aria-label={`Delete ${f.fileName}`} className={dangerBtn}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Payments received */}
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Payments received · {detail.payments.length}</h2>
          {canManage && paymentForm !== "new" && (
            <button onClick={() => setPaymentForm("new")} disabled={pending} className={ghostBtn}>
              + Add payment
            </button>
          )}
        </div>
        <div className="space-y-3 px-4 py-3">
          {canManage && !storageConfigured && uploadNote}
          {paymentForm === "new" && (
            <PaymentForm
              pending={pending}
              onCancel={() => setPaymentForm(null)}
              onSave={(v) => run(() => addPaymentAction({ ...v, programId: detail.id }), () => setPaymentForm(null))}
            />
          )}
          {detail.payments.length === 0 && paymentForm !== "new" ? (
            <p className="py-2 text-center text-xs text-text-muted">No payments recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {detail.payments.map((p) =>
                paymentForm === p.id ? (
                  <li key={p.id}>
                    <PaymentForm
                      initial={p}
                      pending={pending}
                      onCancel={() => setPaymentForm(null)}
                      onSave={(v) => run(() => updatePaymentAction(detail.id, p.id, v), () => setPaymentForm(null))}
                    />
                  </li>
                ) : (
                  <li key={p.id} className="rounded-lg border border-border-subtle bg-surface-sunken/50 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                          <span className="tabular text-xs text-text-muted">{fmtDate(p.receivedDate)}</span>
                          <span className="font-semibold text-text-primary"><Money value={p.amount} /></span>
                          {p.tds > 0 && (
                            <span className="text-xs text-text-muted">+ TDS <Money value={p.tds} /></span>
                          )}
                        </div>
                        {(p.reference || p.note) && (
                          <p className="mt-0.5 text-xs text-text-secondary">
                            {p.reference ? `Ref ${p.reference}` : ""}
                            {p.reference && p.note ? " · " : ""}
                            {p.note ?? ""}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 items-center gap-2">
                          {storageConfigured && (
                            <UploadButton
                              label="Add proof"
                              busy={uploadingKey === `pay-${p.id}`}
                              disabled={pending || uploadingKey !== null}
                              onFile={(f) => upload(`pay-${p.id}`, f, p.id)}
                            />
                          )}
                          <button onClick={() => setPaymentForm(p.id)} disabled={pending} className={ghostBtn}>Edit</button>
                          <button
                            onClick={async () => {
                              const confirmed = await confirmAction({
                                title: "Delete this payment?",
                                description:
                                  p.proofs.length > 0
                                    ? `Its ${p.proofs.length} proof file${p.proofs.length === 1 ? "" : "s"} will be deleted too. This cannot be undone.`
                                    : "This payment will be permanently removed.",
                                confirmLabel: "Delete payment",
                                tone: "danger",
                              });
                              if (confirmed) run(() => deletePaymentAction(detail.id, p.id));
                            }}
                            disabled={pending}
                            className={dangerBtn}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    {p.proofs.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {p.proofs.map((f) => (
                          <li key={f.id} className="flex items-center justify-between gap-3">
                            <FileLink file={f} />
                            {canManage && (
                              <button
                                onClick={() => removeFile(f)}
                                disabled={pending}
                                aria-label={`Delete ${f.fileName}`}
                                className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-[var(--negative-subtle)] hover:text-[var(--negative-text)] disabled:opacity-40"
                              >
                                ✕
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-text-primary">
        <Money value={value} />
      </div>
    </div>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────

type PoValues = {
  poNumber: string | null;
  poDate: string | null;
  poValue: number | null;
  gstRate: number;
  vendorId: number | null;
};

function PoForm({
  detail,
  vendors,
  pending,
  onSave,
  onCancel,
}: {
  detail: ProgramDetail;
  vendors: { id: number; name: string }[];
  pending: boolean;
  onSave: (v: PoValues) => void;
  onCancel: () => void;
}) {
  const [poNumber, setPoNumber] = useState(detail.poNumber ?? "");
  const [poDate, setPoDate] = useState(detail.poDate ?? "");
  const [vendorId, setVendorId] = useState(detail.vendorId === null ? "" : String(detail.vendorId));
  const [poValue, setPoValue] = useState(detail.poValue === null ? "" : String(detail.poValue));
  const [gstRate, setGstRate] = useState(String(detail.gstRate));
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const value = parseMoneyInput(poValue);
    if (value !== null && Number.isNaN(value)) { setLocalError("PO value must be a number, for example 1,000,000."); return; }
    if (value !== null && value <= 0) { setLocalError("PO value must be above zero, or left blank."); return; }
    const gst = parseMoneyInput(gstRate);
    if (gst !== null && Number.isNaN(gst)) { setLocalError("GST rate must be a number, for example 18."); return; }
    if (gst !== null && gst > 100) { setLocalError("GST rate must be between 0 and 100."); return; }
    // The save replaces every PO field, so all of them are always sent.
    onSave({
      poNumber: poNumber.trim() || null,
      poDate: poDate || null,
      poValue: value,
      gstRate: gst ?? DEFAULT_GST_RATE,
      vendorId: vendorId ? Number(vendorId) : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">PO number</span>
          <input autoFocus value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">PO date</span>
          <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={fieldCls}>
            <option value="">No vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">PO value ₹ before GST</span>
          <input value={poValue} onChange={(e) => setPoValue(e.target.value)} inputMode="decimal" placeholder="Total of the PO line items" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">GST rate % <span className="font-normal">(blank = {DEFAULT_GST_RATE})</span></span>
          <input value={gstRate} onChange={(e) => setGstRate(e.target.value)} inputMode="decimal" className={fieldCls} />
        </label>
      </div>
      {localError && <p className={errCls}>{localError}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : "Save PO details"}
        </button>
      </div>
    </form>
  );
}

type PaymentValues = { receivedDate: string; amount: number; tds: number; reference: string | null; note: string | null };

function PaymentForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial?: ProgramPayment;
  pending: boolean;
  onSave: (v: PaymentValues) => void;
  onCancel: () => void;
}) {
  const [receivedDate, setReceivedDate] = useState(initial?.receivedDate ?? todayIso());
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [tds, setTds] = useState(initial && initial.tds > 0 ? String(initial.tds) : "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!receivedDate) { setLocalError("Pick the date the payment was received."); return; }
    const amt = parseMoneyInput(amount);
    if (amt === null || Number.isNaN(amt) || amt <= 0) { setLocalError("Enter the amount received, above zero."); return; }
    const t = parseMoneyInput(tds);
    if (t !== null && Number.isNaN(t)) { setLocalError("TDS must be a number, or left blank."); return; }
    onSave({
      receivedDate,
      amount: amt,
      tds: t ?? 0,
      reference: reference.trim() || null,
      note: note.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-[var(--primary-border)] bg-surface p-3">
      <h3 className="text-sm font-semibold text-text-primary">{initial ? "Edit payment" : "New payment"}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Date received</span>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Amount received ₹</span>
          <input autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">TDS deducted ₹ <span className="font-normal">(optional)</span></span>
          <input value={tds} onChange={(e) => setTds(e.target.value)} inputMode="decimal" placeholder="0" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Reference <span className="font-normal">(UTR / cheque no.)</span></span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={fieldCls} />
        </label>
        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="text-[11px] font-medium text-text-muted">Note <span className="font-normal">(optional)</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} />
        </label>
      </div>
      {localError && <p className={errCls}>{localError}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : initial ? "Save payment" : "Add payment"}
        </button>
      </div>
    </form>
  );
}
