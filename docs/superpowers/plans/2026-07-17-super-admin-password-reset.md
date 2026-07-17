# Super Admin Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super admin set a new password for another user from `/admin/users`, so a forgotten password is no longer a permanent lockout.

**Architecture:** One DAL function behind the existing `assertSuperAdmin` gate, one Server Action mirroring the four that already exist, and a per-row control in the existing `UserCard`. No migration, no new page, no email.

**Tech Stack:** Next.js App Router (Server Actions), TypeScript, Drizzle, bcryptjs, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-17-super-admin-password-reset-design.md`

---

## Background an engineer needs

**Why this exists.** Trackie has no password reset flow at all. `app/(app)/profile/actions.ts` can change your own password but demands the current one. A user who forgets theirs is locked out permanently with no recovery path.

**The house patterns you are mirroring** — read these first:
- `lib/dal/user-admin.ts` — `createUser` (`:40`) is the closest precedent: `assertSuperAdmin`, a length check, `hashPassword`, insert. `assertSuperAdmin` (`:9`) is a private helper in this file.
- `app/(app)/admin/users/actions.ts` — `deleteUserAction` (`:54`) is the shape: `actor()`, call the DAL, `revalidatePath("/admin/users")`, `return { ok: true }`.
- `components/admin/users-admin.tsx` — `UserCard` already receives a **`self: boolean`** prop and already uses `!self && (…)` to hide Delete (`:188`) and `disabled={pending || self}` on the role select (`:177`). It also has an expand/collapse panel pattern (`open` state + `{open && …}`) for Assign accounts. Reuse both.
- `app/(app)/profile/actions.ts` — returns `{ ok, error }` rather than throwing for expected errors (`:48`). Mirror that shape.

**Two facts already verified — do not re-litigate:**
- Aligning `createUser`'s minimum from 6 to 8 **breaks nothing**: both passwords in `lib/dal/user-admin.test.ts` are `"secret123"` (9 chars).
- The seed scripts (`scripts/create-prod-users.ts`, `scripts/create-admin.ts`) insert via `hashPassword` directly and **bypass `createUser` entirely**, so they are unaffected.

**Test setup.** Vitest; `lib/dal/user-admin.test.ts` is an **integration test against a real local Postgres**. That database holds **real Datagami staff records** — tests must create their own throwaway user and delete it in `afterAll` (the existing file already does exactly this at `:43`). Never mutate an existing user.

`npm test` has ONE **pre-existing** failure in `lib/board/constants.test.ts` (`lostCount`) that also fails on `main`. Ignore it.

---

## File Structure

**Modify:**
- `lib/dal/user-admin.ts` — add `resetUserPassword`; align `createUser`'s minimum to 8.
- `lib/dal/user-admin.test.ts` — tests for both.
- `app/(app)/admin/users/actions.ts` — add `resetUserPasswordAction`.
- `components/admin/users-admin.tsx` — per-row "Reset password" control.

**Not touched:** `lib/auth/password.ts`, `lib/auth/config.ts`, `app/(app)/profile/actions.ts`, `proxy.ts`, anything under `scripts/`.

---

### Task 1: DAL + tests

**Files:** Modify `lib/dal/user-admin.ts`, `lib/dal/user-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("user-admin", …)` block in `lib/dal/user-admin.test.ts`. Add `resetUserPassword` to the import from `./user-admin`, and add `import { verifyPassword } from "@/lib/auth/password";`.

```ts
  it("resets another user's password so the new one works and the old one stops", async () => {
    const u = await createUser(SUPER, {
      name: "Reset Target",
      email: "reset-target@datagami.local",
      password: "oldpassword1",
      role: "viewer",
    });
    try {
      await resetUserPassword(SUPER, u.id, "brandnewpass1");

      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      // Verify by BEHAVIOUR, not by "the hash changed" — a garbage hash would
      // also change, and would also pass that weaker assertion.
      expect(await verifyPassword("brandnewpass1", row.passwordHash)).toBe(true);
      expect(await verifyPassword("oldpassword1", row.passwordHash)).toBe(false);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("refuses a non-super-admin actor for every other role", async () => {
    for (const role of ["admin", "hr", "delivery", "viewer"] as const) {
      await expect(
        resetUserPassword({ id: 2, role }, 3, "brandnewpass1"),
      ).rejects.toThrow(/Super Admin/i);
    }
  });

  it("refuses a password shorter than 8 characters", async () => {
    await expect(resetUserPassword(SUPER, 3, "short12")).rejects.toThrow(/8 characters/i);
  });

  it("refuses resetting your own password — that belongs in profile", async () => {
    await expect(resetUserPassword(SUPER, SUPER.id, "brandnewpass1")).rejects.toThrow(/profile/i);
  });

  it("refuses an unknown user", async () => {
    await expect(resetUserPassword(SUPER, 999999, "brandnewpass1")).rejects.toThrow(/not found/i);
  });

  it("createUser now requires 8 characters too", async () => {
    await expect(
      createUser(SUPER, { name: "x", email: "too-short@datagami.local", password: "short12", role: "viewer" }),
    ).rejects.toThrow(/8 characters/i);
  });
```

The file already imports what it needs for `createUser`/`deleteUser`. Add `db`, `users`, and `eq` imports if they are not already present:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dal/user-admin.test.ts`
Expected: FAIL — `resetUserPassword is not a function` (plus the `createUser` 8-char test failing, since it still allows 6).

Requires a local Postgres with seed data. If you get a connection error instead, stop and report.

- [ ] **Step 3: Implement**

In `lib/dal/user-admin.ts`, change `createUser`'s check from:

```ts
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters");
```

to:

```ts
  if (input.password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
```

and add near the top of the file, after the imports:

```ts
/**
 * Matches the self-service rule in app/(app)/profile/actions.ts. These used to
 * disagree (6 here, 8 there), which let an admin-set password be weaker than a
 * user-set one.
 */
const MIN_PASSWORD = 8;
```

Then add the new function after `updateUserRole`:

```ts
/**
 * Set another user's password. The super admin types it and relays it — this is
 * an internal tool and that trade-off was chosen deliberately (see the spec).
 *
 * NOTE: this does NOT sign the target out. Sessions are JWTs
 * (lib/auth/config.ts) and cannot be revoked without a denylist, so an existing
 * session survives the reset. Fixes "forgot my password"; does NOT fix "lock out
 * an intruder".
 */
export async function resetUserPassword(
  actor: SessionUser,
  userId: number,
  newPassword: string,
): Promise<void> {
  assertSuperAdmin(actor);
  // Your own password goes through /profile, which demands the current one.
  // Without this, an unlocked super-admin laptop is a permanent takeover: change
  // the password without knowing the old one.
  if (userId === actor.id) throw new Error("Change your own password from your profile");
  if (newPassword.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new Error("User not found");

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  // There is no audit table; this is the honest minimum for a security action.
  console.info(`[security] password reset by user ${actor.id} for user ${userId}`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/dal/user-admin.test.ts && npx tsc --noEmit`
Expected: PASS; clean. Confirm the throwaway users were cleaned up — no `reset-target@datagami.local` or `too-short@datagami.local` should remain.

- [ ] **Step 5: Commit**

```bash
git add lib/dal/user-admin.ts lib/dal/user-admin.test.ts
git commit -m "feat(admin): super admin can reset another user's password

Trackie had no reset path at all — a forgotten password was a permanent
lockout, since changing one required already being signed in.

Aligns createUser's minimum from 6 to 8 to match profile's rule; they
disagreed, which let an admin-set password be weaker than a user-set one.

Self-reset is refused (that belongs in /profile, which demands the current
password) and every reset is logged, there being no audit table.

Does NOT sign the target out: sessions are JWTs and cannot be revoked."
```

---

### Task 2: Action + UI

**Files:** Modify `app/(app)/admin/users/actions.ts`, `components/admin/users-admin.tsx`

- [ ] **Step 1: Add the Server Action**

In `app/(app)/admin/users/actions.ts`, add `resetUserPassword` to the existing import from `@/lib/dal/user-admin`, then append:

```ts
export async function resetUserPasswordAction(userId: number, password: string) {
  try {
    await resetUserPassword(await actor(), userId, password);
  } catch (e) {
    // A too-short password is an expected error, not an exception — same shape
    // as profile/actions.ts.
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to reset password" };
  }
  revalidatePath("/admin/users");
  return { ok: true as const };
}
```

- [ ] **Step 2: Add the per-row control**

In `components/admin/users-admin.tsx`, add `resetUserPasswordAction` to the existing action import. Inside `UserCard`, add state beside the existing `open`/`error` state:

```tsx
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwDone, setPwDone] = useState(false);
```

and a handler beside `remove()`:

```tsx
  function resetPassword() {
    setError(null);
    setPwDone(false);
    startTransition(async () => {
      const res = await resetUserPasswordAction(user.id, pw);
      if (res.ok) {
        setPwDone(true);
        setPw("");
      } else {
        setError(res.error);
      }
    });
  }
```

Add the trigger button next to Delete, reusing the existing `!self &&` guard (the same one that hides Delete at `:188`):

```tsx
          {!self && (
            <button
              onClick={() => { setPwOpen((o) => !o); setPwDone(false); }}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Reset password
            </button>
          )}
```

And the panel, after the existing `{open && scoped && (…)}` block:

```tsx
      {pwOpen && !self && (
        <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Reset password for {user.email}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Deliberately type="text": this is not your own secret, it is a value
                you must read and pass on. Masking it invites transcription typos. */}
            <input
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="New password (min 8 characters)"
              className={`${inputCls} flex-1 py-1.5`}
            />
            <button
              onClick={resetPassword}
              disabled={pending || pw.length < 8}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Set password"}
            </button>
            <button
              onClick={() => { setPwOpen(false); setPw(""); }}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
          {pwDone && (
            <p className="mt-2 text-xs text-[var(--positive-text)]">
              Password updated. Send it to {user.name} — they are not signed out, and this is the only time it is shown.
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && npx eslint components/admin/users-admin.tsx "app/(app)/admin/users/actions.ts"`
Expected: clean.

- [ ] **Step 4: Verify in the browser — REQUIRED**

A dev server is on **http://localhost:3000** (Browser pane tab `seed`). Use the Browser pane tools; **never** use Bash to run a dev server. Sign in as `verify-admin@test.local` / `Verify@12345` (synthetic, local DB only) and go to `/admin/users`.

**This database holds real staff accounts. Only ever reset `verify-delivery@test.local`, never a real one.**

Verify and report ACTUAL observations:
1. Your own row (Verify Admin) shows **no** "Reset password" button — same rule that hides Delete.
2. Another row shows one; clicking it opens the panel.
3. The input shows characters in **plain text**, not dots.
4. "Set password" is disabled under 8 characters.
5. Reset `verify-delivery@test.local` to `Verify@12345` (its current value — leave it usable for future sessions). Confirm the success line appears.
6. Sign out, sign in as `verify-delivery@test.local` / `Verify@12345` → succeeds. Sign back in as verify-admin.
7. `read_console_messages` → no errors.
8. Server log shows `[security] password reset by user … for user …` (check `preview_logs`).

- [ ] **Step 5: Commit**

```bash
git add components/admin/users-admin.tsx "app/(app)/admin/users/actions.ts"
git commit -m "feat(admin): reset-password control on the user row

Plain-text field on purpose: this is not the admin's own secret, it is a
value they must read and relay, and masking it invites typos that would lock
the user out.

Hidden on your own row, reusing the guard that hides Delete — self-service
goes through /profile, which demands the current password."
```

---

## Discipline

- Commits are authored `aashruti` via local git config — do not change it, do **NOT** add Co-Authored-By.
- Branch is `feat-super-admin-password-reset` (off `main`), already checked out.
- Unrelated uncommitted files (`scripts/reset-db.ts`, `app/api/ping/`, `vercel.json`) — leave alone, never stage.
- Do not touch `lib/auth/password.ts`, `lib/auth/config.ts`, `profile/actions.ts`, `proxy.ts`, or `scripts/`.
