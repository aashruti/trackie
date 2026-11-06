import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailSignatures, employeeProfiles, users } from "@/lib/db/schema";
import { COMPANY_NAME, DEFAULT_ACCENT, DEFAULT_ADDRESS, type SignatureFields } from "@/lib/signature/render";

/**
 * The signed-in user's signature. `defaults` come from their account and HR
 * record; `fields` is their saved version when they have one, else the defaults.
 * Works for users with no employee profile — signatures aren't HR-gated.
 */
export async function getMySignature(
  userId: number,
): Promise<{ fields: SignatureFields; defaults: SignatureFields; saved: boolean } | null> {
  const [row] = await db
    .select({
      name: users.name,
      email: users.email,
      designation: employeeProfiles.designation,
      phone: employeeProfiles.phone,
      saved: emailSignatures,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .leftJoin(emailSignatures, eq(emailSignatures.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  const defaults: SignatureFields = {
    layout: "card",
    font: "sans",
    signOff: "",
    name: row.name,
    title: row.designation ?? "",
    company: COMPANY_NAME,
    extraLine: "",
    email: row.email,
    phone: row.phone ?? "",
    address: DEFAULT_ADDRESS,
    accentColor: DEFAULT_ACCENT,
    badge: "none",
    showEmail: true,
    showWebsite: true,
    showAddress: true,
    showEdudron: true,
  };
  if (!row.saved) return { fields: defaults, defaults, saved: false };

  const s = row.saved;
  return {
    fields: {
      layout: s.layout,
      font: s.font,
      signOff: s.signOff,
      name: s.name,
      title: s.title,
      company: s.company,
      extraLine: s.extraLine,
      email: s.email,
      phone: s.phone,
      address: s.address,
      accentColor: s.accentColor,
      badge: s.badge,
      showEmail: s.showEmail,
      showWebsite: s.showWebsite,
      showAddress: s.showAddress,
      showEdudron: s.showEdudron,
    },
    defaults,
    saved: true,
  };
}

export async function saveMySignature(userId: number, fields: SignatureFields): Promise<void> {
  await db
    .insert(emailSignatures)
    .values({ userId, createdBy: userId, updatedBy: userId, ...fields })
    .onConflictDoUpdate({
      target: emailSignatures.userId,
      set: { ...fields, updatedBy: userId },
    });
}
