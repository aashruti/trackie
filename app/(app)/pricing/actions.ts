"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { updateInvoice, setCohorts, type CohortInput } from "@/lib/dal/mutations";
import { canViewFinance } from "@/lib/dal/authz";
import { isUserError } from "@/lib/dal/errors";

export interface PricingEdit {
  accountId: number;
  invoiceId: number;
  invoice?: { students?: number; priceToUni?: number; priceToDatagami?: number };
  /** Full replacement batch list — sent only when a batch count/price changed. */
  cohorts?: CohortInput[];
}

export type SavePricingResult = { ok: true; saved: number } | { ok: false; error: string };

export async function savePricingAction(edits: PricingEdit[]): Promise<SavePricingResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const user = { id: Number(session.user.id), roles: session.user.roles };
  if (!canViewFinance(user)) {
    return { ok: false, error: "Pricing is available to Sales / Super Admin only" };
  }

  try {
    // Sequential loop over EDITED invoices only — each helper re-checks canEdit
    // and keeps the batch↔scalar sync, so the bulk screen inherits every
    // invariant for free. Bounded by the user's edit batch, not table size.
    const touched = new Set<number>();
    for (const e of edits) {
      if (e.invoice) await updateInvoice(user, e.invoiceId, e.invoice);
      if (e.cohorts) await setCohorts(user, e.invoiceId, e.cohorts);
      touched.add(e.accountId);
    }
    revalidatePath("/pricing");
    for (const id of touched) revalidatePath(`/accounts/${id}`);
    return { ok: true, saved: edits.length };
  } catch (e) {
    // Partial-save is possible (helpers already committed earlier edits); the
    // client refreshes only on ok, so surviving dirty cells simply re-diff.
    console.error("[pricing:save]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not save pricing changes." };
  }
}
