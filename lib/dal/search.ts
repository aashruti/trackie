import "server-only";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, academicYears, invoices, oems } from "@/lib/db/schema";
import { CATEGORIES } from "@/lib/db/enums";
import { canViewFinance, scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { CATEGORY_LABEL, streamLabel, type ReportCategory } from "@/lib/money/report-view";
import { statusMeta } from "@/lib/money/format";
import type { Status } from "@/lib/money/types";

/** One search result — enough to render a row and navigate on select. */
export interface SearchHit {
  /** Row id of the underlying entity (stable React key). */
  id: number;
  label: string;
  sublabel: string;
  /** App route to push on select. */
  href: string;
}

export interface SearchResults {
  accounts: SearchHit[];
  oems: SearchHit[];
  invoices: SearchHit[];
  /** Per-group flag: more matches exist than the cap returns (refine to see). */
  truncated: { accounts: boolean; oems: boolean; invoices: boolean };
}

const EMPTY: SearchResults = {
  accounts: [],
  oems: [],
  invoices: [],
  truncated: { accounts: false, oems: false, invoices: false },
};

/** Max hits shown per group (the palette is a jump-to, not a full report). */
const GROUP_LIMIT = 8;

/**
 * Escape ILIKE wildcards so user input is matched literally — otherwise a typed
 * `%` or `_` would act as a pattern (e.g. `%` matches everything).
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Global command-palette search over finance entities: accounts (universities),
 * OEMs, and current-year invoices/bills.
 *
 * Finance-gated (super-admin / sales only) and account-scoped: a non-super user
 * only ever sees their assigned accounts, the OEMs of those accounts, and those
 * accounts' bills — nothing leaks across the scope boundary. `yearLabel` is
 * resolved by the caller (the route reads the current-year cookie) so this stays
 * free of request context and unit-testable, matching `getReportData`.
 *
 * Prefix matches sort first so the most relevant hits survive the per-group cap;
 * each group reports whether more matches exist so the UI can prompt a refine.
 */
export async function globalSearch(
  user: SessionUser,
  rawQ: string,
  yearLabel: string,
): Promise<SearchResults> {
  const q = rawQ.trim();
  if (!q) return EMPTY;
  if (!canViewFinance(user)) return EMPTY;

  // Independent lookups run together (DAL rule): the user's assigned accounts and
  // the current academic-year row.
  const [assigned, yearRows] = await Promise.all([
    user.roles.includes("super-admin") ? Promise.resolve<number[]>([]) : assignedIds(user.id),
    db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.label, yearLabel)).limit(1),
  ]);
  const scope = scopeAccountIds(user, assigned); // null = unrestricted (super)
  // A scoped user with no assignments can see nothing — skip the queries.
  if (scope !== null && scope.length === 0) return EMPTY;
  const year = yearRows[0];

  const esc = escapeLike(q);
  const pattern = `%${esc}%`;
  const prefix = `${esc}%`;
  const inScope = scope === null ? undefined : inArray(accounts.id, scope);
  const qLower = q.toLowerCase();
  // One past the cap so we can tell the caller "there are more — refine".
  const probe = GROUP_LIMIT + 1;
  // Prefix hits (name starts with the query) rank above mid-string hits.
  const nameRank = (col: typeof accounts.name | typeof oems.name) =>
    sql`case when ${col} ilike ${prefix} then 0 else 1 end`;

  // Bill types whose human label ("Old students") matches the query, so a search
  // for a stream finds its bills even though the DB stores terse codes ("old").
  const matchedCats = CATEGORIES.filter(
    (c) => CATEGORY_LABEL[c as ReportCategory].toLowerCase().includes(qLower) || c.includes(qLower),
  );

  // Invoices match on stored status or stream label; account-name matches already
  // surface in the Accounts group, so they are intentionally excluded here.
  // NOTE: this is the *stored* status — a raised bill past its due date reads as
  // "Overdue" on the account page (effStatus) but is matched/labelled "raised"
  // here. Aging-aware bill search is a deliberate follow-up, not implemented.
  const invConds = [ilike(sql`${invoices.status}::text`, pattern)];
  if (matchedCats.length) invConds.push(inArray(invoices.category, matchedCats));

  const [accRows, oemRows, invRows] = await Promise.all([
    // Accounts — by name, city, or their OEM's name.
    db
      .select({ id: accounts.id, name: accounts.name, city: accounts.city, oem: oems.name })
      .from(accounts)
      .innerJoin(oems, eq(accounts.oemId, oems.id))
      .where(and(inScope, or(ilike(accounts.name, pattern), ilike(accounts.city, pattern), ilike(oems.name, pattern))))
      .orderBy(nameRank(accounts.name), asc(accounts.name))
      .limit(probe),

    // OEMs — by name. Scoped users only see OEMs that have an assigned account
    // (the innerJoin + scope filter); super-admins see all matching OEMs.
    scope === null
      ? db
          .select({ id: oems.id, name: oems.name, isSelf: oems.isSelf })
          .from(oems)
          .where(ilike(oems.name, pattern))
          .orderBy(nameRank(oems.name), asc(oems.name))
          .limit(probe)
      : // SELECT DISTINCT forbids ordering by a non-selected expression, so the
        // scoped branch ranks by name only (a scoped user's OEM list is short).
        db
          .selectDistinct({ id: oems.id, name: oems.name, isSelf: oems.isSelf })
          .from(oems)
          .innerJoin(accounts, eq(accounts.oemId, oems.id))
          .where(and(inArray(accounts.id, scope), ilike(oems.name, pattern)))
          .orderBy(asc(oems.name))
          .limit(probe),

    // Invoices — current year only. No year row → no bill search.
    year
      ? db
          .select({
            id: invoices.id,
            accountId: invoices.accountId,
            accountName: accounts.name,
            category: invoices.category,
            semester: invoices.semester,
            status: invoices.status,
          })
          .from(invoices)
          .innerJoin(accounts, eq(invoices.accountId, accounts.id))
          .where(and(eq(invoices.yearId, year.id), inScope, or(...invConds)))
          .orderBy(asc(accounts.name))
          .limit(probe)
      : Promise.resolve([] as { id: number; accountId: number; accountName: string; category: string; semester: string; status: string }[]),
  ]);

  return {
    accounts: accRows.slice(0, GROUP_LIMIT).map((a) => ({
      id: a.id,
      label: a.name,
      sublabel: [a.city, a.oem].filter(Boolean).join(" · "),
      href: `/accounts/${a.id}`,
    })),
    oems: oemRows.slice(0, GROUP_LIMIT).map((o) => ({
      id: o.id,
      label: o.isSelf ? `${o.name} (own product)` : o.name,
      sublabel: "OEM report",
      href: `/reports/oem/${encodeURIComponent(o.name)}`,
    })),
    invoices: invRows.slice(0, GROUP_LIMIT).map((i) => ({
      id: i.id,
      label: i.accountName,
      sublabel: `${streamLabel(i.category, i.semester)} · ${statusMeta(i.status as Status)[1]}`,
      href: `/accounts/${i.accountId}`,
    })),
    truncated: {
      accounts: accRows.length > GROUP_LIMIT,
      oems: oemRows.length > GROUP_LIMIT,
      invoices: invRows.length > GROUP_LIMIT,
    },
  };
}
