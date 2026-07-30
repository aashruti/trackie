"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import type { DeliveryAccountListRow } from "@/lib/dal/delivery/accounts";

type AccommodationFilter = "all" | "guest-house" | "preferred-stays" | "needs-setup";

const filterClass =
  "h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function DeliveryAccountsExplorer({ accounts }: { accounts: DeliveryAccountListRow[] }) {
  const [search, setSearch] = useState("");
  const [accommodation, setAccommodation] = useState<AccommodationFilter>("all");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (query && !`${account.name} ${account.city ?? ""}`.toLowerCase().includes(query)) return false;
      if (accommodation === "guest-house" && account.guestHouseAvailable !== true) return false;
      if (accommodation === "preferred-stays" && account.preferredStayCount === 0) return false;
      if (
        accommodation === "needs-setup" &&
        (account.guestHouseAvailable === true || account.preferredStayCount > 0)
      ) return false;
      return true;
    });
  }, [accounts, search, accommodation]);

  const readyCount = accounts.filter(
    (account) => account.guestHouseAvailable === true || account.preferredStayCount > 0,
  ).length;
  const locatedCount = accounts.filter((account) => account.hasCampusLocation).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Delivery accounts</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Campus and accommodation details for the universities assigned to you.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
          <span><strong className="text-base text-text-primary">{accounts.length}</strong> assigned</span>
          <span><strong className="text-base text-text-primary">{locatedCount}</strong> mapped</span>
          <span><strong className="text-base text-text-primary">{readyCount}</strong> stay-ready</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="delivery-account-search" className="sr-only">Search delivery accounts</label>
        <input
          id="delivery-account-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search universities or cities…"
          className="h-9 min-w-64 flex-1 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <select
          value={accommodation}
          onChange={(event) => setAccommodation(event.target.value as AccommodationFilter)}
          className={filterClass}
          aria-label="Filter by accommodation"
        >
          <option value="all">All accommodation</option>
          <option value="guest-house">Guest house available</option>
          <option value="preferred-stays">Has preferred stays</option>
          <option value="needs-setup">Accommodation needs setup</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-secondary">
            {accounts.length === 0 ? "No universities are assigned to you yet." : "No universities match these filters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((account) => {
            const accommodationReady =
              account.guestHouseAvailable === true || account.preferredStayCount > 0;
            return (
              <Link
                key={account.id}
                href={`/delivery/accounts/${account.id}`}
                className="group rounded-xl border border-border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--primary-border)] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-text-primary group-hover:text-[var(--primary-text)]">
                      {account.name}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary">{account.city || "City not recorded"}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      accommodationReady
                        ? "border-[var(--positive-border)] bg-[var(--positive-subtle)] text-[var(--positive-text)]"
                        : "border-border bg-surface-sunken text-text-muted"
                    }`}
                  >
                    {accommodationReady ? "Stay ready" : "Needs setup"}
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-subtle pt-4 text-xs">
                  <div>
                    <dt className="text-text-muted">Guest house</dt>
                    <dd className="mt-1 font-medium text-text-primary">
                      {account.guestHouseAvailable == null
                        ? "Not recorded"
                        : account.guestHouseAvailable
                          ? account.guestHouseCostPerNight == null
                            ? "Available"
                            : <><Money value={account.guestHouseCostPerNight} /> / night</>
                          : "Not available"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Preferred stays</dt>
                    <dd className="mt-1 font-medium text-text-primary">
                      {account.preferredStayCount} option{account.preferredStayCount === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Campus location</dt>
                    <dd className="mt-1 font-medium text-text-primary">
                      {account.hasCampusLocation ? "Mapped" : "Not mapped"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Programs</dt>
                    <dd className="mt-1 font-medium text-text-primary">
                      {account.activeProgramCount} active · {account.programCount} total
                    </dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
