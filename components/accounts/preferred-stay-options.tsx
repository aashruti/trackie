"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  createPreferredStayAction,
  deletePreferredStayAction,
  updatePreferredStayAction,
} from "@/app/(app)/accounts/[id]/actions";
import { useAppDialog } from "@/components/ui/app-dialog";
import { Money } from "@/components/ui/money";

export interface PreferredStayOption {
  id: number;
  name: string;
  address: string | null;
  costPerNight: number | null;
  bookingUrl: string | null;
  contactPhone: string | null;
}

type StayDraft = {
  name: string;
  address: string;
  costPerNight: string;
  bookingUrl: string;
  contactPhone: string;
};

const EMPTY_STAY: StayDraft = {
  name: "",
  address: "",
  costPerNight: "",
  bookingUrl: "",
  contactPhone: "",
};

function draftFrom(stay: PreferredStayOption): StayDraft {
  return {
    name: stay.name,
    address: stay.address ?? "",
    costPerNight: stay.costPerNight == null ? "" : String(stay.costPerNight),
    bookingUrl: stay.bookingUrl ?? "",
    contactPhone: stay.contactPhone ?? "",
  };
}

function parseOptionalCost(value: string) {
  return value.trim() ? Number(value) : null;
}

export function PreferredStayOptions({
  accountId,
  guestHouseAvailable,
  stays,
  canEdit,
}: {
  accountId: number;
  guestHouseAvailable: boolean | null;
  stays: PreferredStayOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const dialogs = useAppDialog();
  const modalRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<PreferredStayOption | "new" | null>(null);
  const [draft, setDraft] = useState<StayDraft>(EMPTY_STAY);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const contextCopy = guestHouseAvailable === false
    ? "Use these options when arranging accommodation for a campus visit."
    : guestHouseAvailable === true
      ? "Back-up stays for times when the university guest house cannot be used."
      : "Recommended accommodation near the university for future visits.";

  function openNew() {
    setDraft(EMPTY_STAY);
    setError(null);
    setEditing("new");
  }

  function openEdit(stay: PreferredStayOption) {
    setDraft(draftFrom(stay));
    setError(null);
    setEditing(stay);
  }

  function closeModal() {
    if (pending) return;
    setEditing(null);
    setError(null);
  }

  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        setEditing(null);
        setError(null);
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [editing, pending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    const costPerNight = parseOptionalCost(draft.costPerNight);
    if (!draft.name.trim()) {
      setError("Enter a name for this stay.");
      return;
    }
    if (costPerNight != null && (!Number.isFinite(costPerNight) || costPerNight < 0)) {
      setError("Enter a valid cost per night.");
      return;
    }
    const input = {
      name: draft.name,
      address: draft.address,
      costPerNight,
      bookingUrl: draft.bookingUrl,
      contactPhone: draft.contactPhone,
    };

    startTransition(async () => {
      const result = editing === "new"
        ? await createPreferredStayAction(accountId, input)
        : await updatePreferredStayAction(accountId, editing.id, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  async function remove(stay: PreferredStayOption) {
    const confirmed = await dialogs.confirmAction({
      title: "Remove preferred stay?",
      description: `${stay.name} will be removed from this university’s booking options.`,
      confirmLabel: "Remove stay",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeletingId(stay.id);
    startTransition(async () => {
      const result = await deletePreferredStayAction(accountId, stay.id);
      setDeletingId(null);
      if (!result.ok) {
        await dialogs.showAlert({
          title: "Could not remove stay",
          description: result.error,
          tone: "danger",
        });
        return;
      }
      router.refresh();
    });
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  return (
    <>
      <section className="border-t border-border-subtle px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Preferred stays</p>
            <p className="mt-1 text-sm text-text-secondary">{contextCopy}</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openNew}
              className="no-print rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90"
            >
              + Add stay option
            </button>
          )}
        </div>

        {stays.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-sunken px-5 py-6 text-center">
            <p className="text-sm font-medium text-text-secondary">No preferred stays recorded</p>
            <p className="mt-1 text-xs text-text-muted">Add hotels, serviced apartments, or other reliable booking choices.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {stays.map((stay) => (
              <article key={stay.id} className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-text-primary">{stay.name}</h4>
                    {stay.address && <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{stay.address}</p>}
                  </div>
                  {canEdit && (
                    <div className="no-print flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(stay)}
                        disabled={pending}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--info-text)] hover:bg-surface-hover disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(stay)}
                        disabled={pending}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-50"
                      >
                        {deletingId === stay.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-border-subtle pt-3">
                  <div>
                    <p className="text-[11px] text-text-muted">Estimated per night</p>
                    <p className="mt-0.5 text-sm font-semibold text-text-primary">
                      {stay.costPerNight == null ? "Not recorded" : <Money value={stay.costPerNight} />}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 text-xs">
                    {stay.contactPhone && (
                      <a className="font-medium text-[var(--info-text)] hover:underline" href={`tel:${stay.contactPhone}`}>
                        Call
                      </a>
                    )}
                    {stay.bookingUrl && (
                      <a
                        className="font-medium text-[var(--info-text)] hover:underline"
                        href={stay.bookingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Booking link ↗
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferred-stay-dialog-title"
            className="my-auto w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-2xl"
          >
            <form onSubmit={submit}>
              <h3 id="preferred-stay-dialog-title" className="text-base font-semibold text-text-primary">
                {editing === "new" ? "Add preferred stay" : "Edit preferred stay"}
              </h3>
              <p className="mt-1 text-xs text-text-muted">
                Save the details your team needs to compare and book accommodation.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-text-secondary">Stay name *</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className={inputClass}
                    placeholder="e.g. Lemon Tree Hotel"
                    maxLength={120}
                    autoFocus
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-text-secondary">Area or address</span>
                  <textarea
                    value={draft.address}
                    onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                    className={`${inputClass} min-h-20 resize-y`}
                    placeholder="Neighbourhood, landmark, or full address"
                    maxLength={500}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-secondary">Estimated cost per night (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.costPerNight}
                    onChange={(event) => setDraft({ ...draft, costPerNight: event.target.value })}
                    className={inputClass}
                    placeholder="e.g. 2500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-secondary">Contact phone</span>
                  <input
                    type="tel"
                    value={draft.contactPhone}
                    onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })}
                    className={inputClass}
                    placeholder="e.g. +91 98765 43210"
                    maxLength={50}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-text-secondary">Booking link</span>
                  <input
                    type="url"
                    value={draft.bookingUrl}
                    onChange={(event) => setDraft({ ...draft, bookingUrl: event.target.value })}
                    className={inputClass}
                    placeholder="https://hotel.example.com/book"
                    maxLength={1000}
                  />
                </label>
              </div>

              {error && <p className="mt-3 text-sm text-[var(--negative-text)]">{error}</p>}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={pending}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Saving…" : editing === "new" ? "Add stay" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
