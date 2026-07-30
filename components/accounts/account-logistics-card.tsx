"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAccountLogisticsAction } from "@/app/(app)/accounts/[id]/actions";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export interface AccountLogistics {
  latitude: number | null;
  longitude: number | null;
  guestHouseAvailable: boolean | null;
  guestHouseCostPerNight: number | null;
}

function osmUrls(latitude: number, longitude: number) {
  const latDelta = 0.015;
  const lonDelta = 0.02;
  const bbox = [
    longitude - lonDelta,
    latitude - latDelta,
    longitude + lonDelta,
    latitude + latDelta,
  ].join(",");
  const embed = new URLSearchParams({
    bbox,
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  });
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?${embed.toString()}`,
    view: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
}

function nullableNumber(value: string): number | null {
  const clean = value.trim();
  return clean ? Number(clean) : null;
}

export function AccountLogisticsCard({
  accountId,
  accountName,
  city,
  logistics,
  canEdit,
}: {
  accountId: number;
  accountName: string;
  city: string | null;
  logistics: AccountLogistics;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [latitude, setLatitude] = useState(logistics.latitude == null ? "" : String(logistics.latitude));
  const [longitude, setLongitude] = useState(logistics.longitude == null ? "" : String(logistics.longitude));
  const [guestHouse, setGuestHouse] = useState(
    logistics.guestHouseAvailable == null ? "unknown" : logistics.guestHouseAvailable ? "yes" : "no",
  );
  const [guestHouseCost, setGuestHouseCost] = useState(
    logistics.guestHouseCostPerNight == null ? "" : String(logistics.guestHouseCostPerNight),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  const map = useMemo(
    () => logistics.latitude == null || logistics.longitude == null
      ? null
      : osmUrls(logistics.latitude, logistics.longitude),
    [logistics.latitude, logistics.longitude],
  );
  const searchUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent([accountName, city].filter(Boolean).join(", "))}`;
  const inputCls =
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  function resetAndClose() {
    setLatitude(logistics.latitude == null ? "" : String(logistics.latitude));
    setLongitude(logistics.longitude == null ? "" : String(logistics.longitude));
    setGuestHouse(logistics.guestHouseAvailable == null ? "unknown" : logistics.guestHouseAvailable ? "yes" : "no");
    setGuestHouseCost(logistics.guestHouseCostPerNight == null ? "" : String(logistics.guestHouseCostPerNight));
    setError(null);
    setOpen(false);
  }

  function openEditor() {
    setLatitude(logistics.latitude == null ? "" : String(logistics.latitude));
    setLongitude(logistics.longitude == null ? "" : String(logistics.longitude));
    setGuestHouse(logistics.guestHouseAvailable == null ? "unknown" : logistics.guestHouseAvailable ? "yes" : "no");
    setGuestHouseCost(logistics.guestHouseCostPerNight == null ? "" : String(logistics.guestHouseCostPerNight));
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) resetAndClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    };
  });

  function save() {
    setError(null);
    const parsedLatitude = nullableNumber(latitude);
    const parsedLongitude = nullableNumber(longitude);
    const parsedCost = guestHouse === "yes" ? nullableNumber(guestHouseCost) : null;
    if ((parsedLatitude == null) !== (parsedLongitude == null)) {
      setError("Enter both latitude and longitude, or leave both blank.");
      return;
    }
    if (
      (parsedLatitude != null && !Number.isFinite(parsedLatitude)) ||
      (parsedLongitude != null && !Number.isFinite(parsedLongitude)) ||
      (parsedCost != null && !Number.isFinite(parsedCost))
    ) {
      setError("Enter valid numbers for coordinates and cost.");
      return;
    }

    startTransition(async () => {
      const result = await updateAccountLogisticsAction(accountId, {
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        guestHouseAvailable: guestHouse === "unknown" ? null : guestHouse === "yes",
        guestHouseCostPerNight: parsedCost,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">University logistics</h3>
            <p className="mt-0.5 text-xs text-text-muted">Shared campus information for Sales and Delivery</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openEditor}
              className="no-print rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
            >
              Edit logistics
            </button>
          )}
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Campus location</p>
                <p className="mt-0.5 text-sm text-text-secondary">{city || "City not recorded"}</p>
              </div>
              {map && (
                <a
                  href={map.view}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-[var(--info-text)] hover:underline"
                >
                  Open map ↗
                </a>
              )}
            </div>
            {map ? (
              <>
                <iframe
                  title={`${accountName} campus location`}
                  src={map.embed}
                  loading="lazy"
                  className="no-print h-56 w-full rounded-lg border border-border"
                />
                <p className="mt-2 font-mono text-[11px] text-text-muted">
                  {logistics.latitude?.toFixed(6)}, {logistics.longitude?.toFixed(6)}
                </p>
              </>
            ) : (
              <div className="grid h-40 place-items-center rounded-lg border border-dashed border-border bg-surface-sunken px-5 text-center">
                <div>
                  <p className="text-sm font-medium text-text-secondary">Campus coordinates not recorded</p>
                  <a href={searchUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--info-text)] hover:underline">
                    Find the university on OpenStreetMap ↗
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Guest house</p>
            {logistics.guestHouseAvailable == null ? (
              <>
                <p className="mt-2 text-base font-semibold text-text-secondary">Not recorded</p>
                <p className="mt-1 text-xs text-text-muted">Confirm accommodation availability with the university.</p>
              </>
            ) : logistics.guestHouseAvailable ? (
              <>
                <p className="mt-2 text-base font-semibold text-[var(--positive-text)]">Available</p>
                <p className="mt-3 text-xs text-text-muted">Cost per night</p>
                <p className="mt-1 text-xl font-semibold text-text-primary">
                  {logistics.guestHouseCostPerNight == null
                    ? <span className="text-sm font-medium text-text-secondary">Not recorded</span>
                    : <Money value={logistics.guestHouseCostPerNight} />}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-base font-semibold text-[var(--negative-text)]">Not available</p>
                <p className="mt-1 text-xs text-text-muted">Plan external accommodation for campus visits.</p>
              </>
            )}
          </div>
        </div>
      </Card>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) resetAndClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-logistics-title"
            className="my-auto w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-xl"
          >
            <div>
              <h3 id="account-logistics-title" className="text-base font-semibold text-text-primary">Edit university logistics</h3>
              <p className="mt-1 text-xs text-text-muted">Coordinates power the OpenStreetMap campus preview. Both coordinates are required together.</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-text-secondary">Latitude</span>
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="0.000001"
                  value={latitude}
                  onChange={(event) => {
                    setLatitude(event.target.value);
                    setError(null);
                  }}
                  className={inputCls}
                  placeholder="e.g. 22.719568"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-text-secondary">Longitude</span>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="0.000001"
                  value={longitude}
                  onChange={(event) => {
                    setLongitude(event.target.value);
                    setError(null);
                  }}
                  className={inputCls}
                  placeholder="e.g. 75.857727"
                />
              </label>
              <a href={searchUrl} target="_blank" rel="noreferrer" className="sm:col-span-2 text-xs text-[var(--info-text)] hover:underline">
                Find coordinates on OpenStreetMap ↗
              </a>

              <label className="block">
                <span className="text-xs font-medium text-text-secondary">Guest house</span>
                <select
                  value={guestHouse}
                  onChange={(event) => {
                    setGuestHouse(event.target.value);
                    setError(null);
                  }}
                  className={inputCls}
                >
                  <option value="unknown">Not recorded</option>
                  <option value="yes">Available</option>
                  <option value="no">Not available</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-text-secondary">Cost per night (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={guestHouseCost}
                  onChange={(event) => {
                    setGuestHouseCost(event.target.value);
                    setError(null);
                  }}
                  disabled={guestHouse !== "yes"}
                  className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-50`}
                  placeholder="e.g. 1500"
                />
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-[var(--negative-text)]">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetAndClose}
                disabled={pending}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save logistics"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
