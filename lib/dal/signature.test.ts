import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeProfiles } from "@/lib/db/schema";
import { getMySignature, saveMySignature } from "./signature";
import { createUser, deleteUser } from "./user-admin";
import { COMPANY_NAME, DEFAULT_ACCENT, type SignatureFields } from "@/lib/signature/render";

const SUPER = { id: 1, roles: ["super-admin" as const] };

describe("email signature storage", () => {
  const made: number[] = [];

  async function throwaway(email: string) {
    const u = await createUser(SUPER, {
      name: "Signature Test",
      email,
      password: "throwaway1",
      roles: ["viewer"],
    });
    made.push(u.id);
    return u.id;
  }

  // Every field differs from its default, so a dropped column can't pass unnoticed.
  const custom: SignatureFields = {
    layout: "plain",
    font: "serif",
    signOff: "Warm Regards",
    name: "Custom Name",
    title: "Custom Title",
    company: "Custom Company",
    extraLine: "Custom Line",
    email: "custom@datagami.local",
    phone: "7738170621",
    address: "Custom Address",
    accentColor: "#0F766E",
    badge: "ibm-ice",
    showEmail: false,
    showWebsite: false,
    showAddress: false,
    showEdudron: false,
  };

  it("returns null for an unknown user", async () => {
    expect(await getMySignature(-1)).toBeNull();
  });

  it("starts from account defaults for a user with no employee record", async () => {
    const uid = await throwaway("sig-defaults@datagami.local");
    const res = await getMySignature(uid);
    expect(res?.saved).toBe(false);
    expect(res?.fields).toEqual(res?.defaults);
    expect(res?.fields).toMatchObject({
      name: "Signature Test",
      email: "sig-defaults@datagami.local",
      title: "",
      phone: "",
      company: COMPANY_NAME,
      accentColor: DEFAULT_ACCENT,
      layout: "card",
    });
  });

  it("seeds title and phone from the employee record", async () => {
    const uid = await throwaway("sig-hr@datagami.local");
    await db.insert(employeeProfiles).values({
      userId: uid,
      employeeCode: `SIGTEST${uid}`,
      designation: "Head of Testing",
      phone: "9876543210",
    });
    const res = await getMySignature(uid);
    expect(res?.fields).toMatchObject({ title: "Head of Testing", phone: "9876543210" });
  });

  it("round-trips every field, and updates in place on a second save", async () => {
    const uid = await throwaway("sig-save@datagami.local");
    await saveMySignature(uid, custom);
    const first = await getMySignature(uid);
    expect(first?.saved).toBe(true);
    expect(first?.fields).toEqual(custom);

    await saveMySignature(uid, { ...custom, title: "Changed Title" });
    expect((await getMySignature(uid))?.fields.title).toBe("Changed Title");
  });

  it("never writes back to the employee record", async () => {
    const uid = await throwaway("sig-nowrite@datagami.local");
    await db.insert(employeeProfiles).values({
      userId: uid,
      employeeCode: `SIGTEST${uid}`,
      designation: "Original",
      phone: "9876543210",
    });
    await saveMySignature(uid, custom);
    const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, uid));
    expect(profile).toMatchObject({ designation: "Original", phone: "9876543210" });
  });

  it("keeps one user's signature away from another's", async () => {
    const mine = await throwaway("sig-mine@datagami.local");
    const theirs = await throwaway("sig-theirs@datagami.local");
    await saveMySignature(mine, custom);
    expect((await getMySignature(theirs))?.saved).toBe(false);
  });

  afterAll(async () => {
    for (const id of made) await deleteUser(SUPER, id);
  });
});
