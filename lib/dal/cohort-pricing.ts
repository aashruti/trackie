import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cohorts } from "@/lib/db/schema";
import type { CohortPricing } from "@/lib/money/types";

/**
 * Cohort counts + optional locked prices per invoice, for the money engine.
 * Returns a Map invoiceId → CohortPricing[]. Invoices with no cohorts are absent
 * (the engine then uses the single invoice price).
 */
export async function loadCohortPricing(
  invoiceIds: number[],
): Promise<Map<number, CohortPricing[]>> {
  const map = new Map<number, CohortPricing[]>();
  if (invoiceIds.length === 0) return map;
  const rows = await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invoiceIds));
  for (const r of rows) {
    const list = map.get(r.invoiceId) ?? [];
    list.push({
      count: r.count,
      priceToUni: r.priceToUni == null ? null : Number(r.priceToUni),
      priceToDatagami: r.priceToDatagami == null ? null : Number(r.priceToDatagami),
    });
    map.set(r.invoiceId, list);
  }
  return map;
}
