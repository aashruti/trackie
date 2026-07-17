# Session Revocation on Password Change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a password change — by an admin or by the user — invalidate that user's existing sessions, so a reset can lock out an intruder and not just recover a forgotten password.

**Architecture:** A nullable `password_changed_at` stamp on `users`, carried into the JWT at sign-in as `pwc` and compared for **equality** on every later request. Mismatch → the `jwt` callback returns `null` → Auth.js clears the cookie. No clock comparison.

**Tech Stack:** Auth.js v5 (`next-auth@5.0.0-beta.31`), Next.js App Router, Drizzle, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-session-revocation-on-password-change-design.md` — read it, especially §2 (why database sessions are impossible) and §3 (the login-loop trap).

---

## Background an engineer needs

**The trap this design exists to avoid.** The obvious implementation compares `passwordChangedAt` to the token's `iat`. **It causes an infinite login loop.** JWT `iat` is in *seconds* (floored); the stamp is in *milliseconds*. Reset at `10:00:00.700`, sign in at `10:00:00.900` → the fresh token's `iat` is `10:00:00.000`, earlier than the stamp → the new token invalidates itself immediately. **Do not compare `iat`.** Compare the stamp for equality — it is the version.

**Why not database sessions:** Auth.js throws `UnsupportedStrategy` for credentials-only providers (`@auth/core/lib/utils/assert.js:114`). Setting `strategy: "database"` breaks login entirely. Do not try it.

**The invalidation hook is real and verified:** the `jwt` callback returns `Awaitable<JWT | null>` (`@auth/core/index.d.ts:331`), and `null` triggers `sessionStore.clean()` (`@auth/core/lib/actions/session.js:54`).

**`authorize` already SELECTs the whole user row** (`lib/auth/config.ts:18`), so reading the stamp there costs nothing extra.

**Project rules (CLAUDE.md — hard):**
- Every schema change goes through a Drizzle migration file in `drizzle/`. **Never mutate the DB with ad-hoc scripts.**
- Create the `.sql`, add its entry to `drizzle/meta/_journal.json`, then run `npx tsx scripts/db-migrate.ts`.
- **Never** `CREATE TYPE IF NOT EXISTS` — Postgres has no such syntax.
- `drizzle.__drizzle_migrations` is the source of truth; do not pre-seed or bypass it.

**⚠ This database holds REAL Datagami staff records.** Never run a seed or reset script. Tests create their own throwaway user and delete it in `afterAll` — `lib/dal/user-admin.test.ts` already does exactly this.

**Test/dev notes.** Vitest; `npm test` has ONE pre-existing failure in `lib/board/constants.test.ts` (`lostCount`) that also fails on `main` — ignore it. **Stop any dev server before running DB tests** or you will hit `PostgresError: sorry, too many clients already` — that is connection exhaustion, not a real failure. Never use Bash to start a dev server; use the Browser pane's `preview_start`.

---

## File Structure

**Create:**
- `drizzle/0012_password_changed_at.sql`

**Modify:**
- `drizzle/meta/_journal.json` — the `0012` entry
- `lib/db/schema.ts` — the column
- `lib/auth/config.ts` — `authorize` returns `pwc`; `jwt` callback checks it
- `lib/dal/user-admin.ts` — `resetUserPassword` stamps it; delete the now-false comment
- `app/(app)/profile/actions.ts` — self-change stamps it
- `lib/dal/user-admin.test.ts` — stamping tests

**Not touched:** `proxy.ts`, `lib/auth/password.ts`, anything under `scripts/`, and the user's uncommitted `scripts/reset-db.ts` / `app/api/ping/` / `vercel.json` — **never stage those**.

---

### Task 1: Migration + column

**Files:** Create `drizzle/0012_password_changed_at.sql`; modify `drizzle/meta/_journal.json`, `lib/db/schema.ts`

- [ ] **Step 1: Write the migration**

Create `drizzle/0012_password_changed_at.sql`:

```sql
-- Session revocation: stamped whenever a password changes (admin reset or
-- self-change). The JWT carries the stamp from sign-in; a mismatch on a later
-- request invalidates the session.
-- NULLABLE on purpose: existing users have no stamp, so nobody is logged out
-- when this deploys.
-- Spec: docs/superpowers/specs/2026-07-17-session-revocation-on-password-change-design.md
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;
```

- [ ] **Step 2: Add the journal entry**

Append to the `entries` array in `drizzle/meta/_journal.json`, after the `0011_account_groups` entry (mind the comma on the preceding `}`):

```json
    {
      "idx": 12,
      "version": "7",
      "when": 1784018200000,
      "tag": "0012_password_changed_at",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add the column to the schema**

In `lib/db/schema.ts`, inside the `users` table, after `emailVerifiedAt`:

```ts
  // Stamped on every password change. The JWT carries this value from sign-in;
  // the jwt callback invalidates the session when it no longer matches.
  passwordChangedAt: timestamp("password_changed_at"),
```

- [ ] **Step 4: Run the migration**

Run: `npx tsx scripts/db-migrate.ts`
Expected: applies `0012_password_changed_at`.

Then prove the column exists and that **every existing row is NULL** — that is what guarantees the deploy logs nobody out. Write this throwaway file, run it, then delete it. (Plain `tsx` will NOT resolve `server-only`; vitest aliases it, so it must be a `*.test.ts` run through vitest.)

`tmp-col.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

describe("0012 migration", () => {
  it("adds password_changed_at, NULL for every existing user", async () => {
    const rows = await db.select({ id: users.id, pwc: users.passwordChangedAt }).from(users);
    expect(rows.length).toBeGreaterThan(0);
    // All NULL → no existing session is invalidated when this deploys.
    expect(rows.filter((r) => r.pwc !== null)).toEqual([]);
  });
});
```

Run: `npx vitest run tmp-col.test.ts` → expect PASS. Then `rm tmp-col.test.ts` and confirm it is gone.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add drizzle/0012_password_changed_at.sql drizzle/meta/_journal.json lib/db/schema.ts
git commit -m "feat(auth): add password_changed_at to users

Nullable on purpose — existing users have no stamp, so deploying this logs
nobody out. Stamped on password change; the JWT compares it to revoke."
```

---

### Task 2: Stamp on both password-change paths

**Files:** Modify `lib/dal/user-admin.ts`, `app/(app)/profile/actions.ts`, `lib/dal/user-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("user-admin", …)` in `lib/dal/user-admin.test.ts`:

```ts
  it("stamps passwordChangedAt on reset, and moves it forward on a second reset", async () => {
    const u = await createUser(SUPER, {
      name: "Stamp Target",
      email: "stamp-target@datagami.local",
      password: "oldpassword1",
      role: "viewer",
    });
    try {
      const [before] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      // A brand-new user has never changed their password.
      expect(before.passwordChangedAt).toBeNull();

      await resetUserPassword(SUPER, u.id, "brandnewpass1");
      const [first] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      expect(first.passwordChangedAt).not.toBeNull();

      await resetUserPassword(SUPER, u.id, "thirdpassword1");
      const [second] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      // Must move forward: the JWT compares this for equality, so a stamp that
      // did not change would leave the older token valid.
      expect(second.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(
        first.passwordChangedAt!.getTime(),
      );
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/dal/user-admin.test.ts`
Expected: FAIL — `expected null not to be null` on the first reset, because nothing stamps yet.

- [ ] **Step 3: Stamp in `resetUserPassword`**

In `lib/dal/user-admin.ts`, change the update to set both fields:

```ts
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() })
    .where(eq(users.id, userId));
```

And **delete the now-false paragraph** from its docblock — the one beginning "NOTE: this does NOT sign the target out." Replace it with:

```
 * Signs the target out everywhere: the stamp bumps, so their JWT no longer
 * matches and the next request clears it. This is what makes the feature usable
 * for a compromised account, not just a forgotten password.
```

- [ ] **Step 4: Stamp in the profile self-change**

In `app/(app)/profile/actions.ts`, change:

```ts
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));
```

to:

```ts
  // Stamping here signs you out everywhere, including this session — deliberate:
  // a user who suspects compromise can evict an intruder without an admin.
  await db
    .update(users)
    .set({ passwordHash: hash, passwordChangedAt: new Date() })
    .where(eq(users.id, userId));
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run lib/dal/user-admin.test.ts && npx tsc --noEmit`
Expected: PASS (9 tests); clean. Confirm no `stamp-target@datagami.local` row survives.

```bash
git add lib/dal/user-admin.ts "app/(app)/profile/actions.ts" lib/dal/user-admin.test.ts
git commit -m "feat(auth): stamp passwordChangedAt on every password change

Both paths stamp it: an admin reset and a profile self-change. Self-change
signs you out too — deliberate, so a user who suspects compromise can evict
an intruder without waiting for an admin.

Deletes resetUserPassword's 'does NOT sign the target out' note: with the
stamp, it now does."
```

---

### Task 3: The JWT check

**Files:** Modify `lib/auth/config.ts`

- [ ] **Step 1: Return the stamp from `authorize`**

`authorize` already SELECTs the whole row, so this costs no extra query:

```ts
        return {
          id: String(u.id),
          name: u.name,
          email: u.email,
          role: u.role,
          pwc: String(u.passwordChangedAt?.getTime() ?? 0),
        };
```

- [ ] **Step 2: Check it in the `jwt` callback**

Replace the existing `jwt` callback:

```ts
    /**
     * Revocation. On sign-in the token records the user's password stamp; on
     * every later request we re-read it and bail if it moved.
     *
     * EQUALITY, deliberately — never a comparison against `iat`. JWT `iat` is
     * floored to SECONDS while the stamp is milliseconds, so a token issued in
     * the same second as a reset would look older than the stamp and invalidate
     * itself: sign in, bounce, sign in, bounce, forever. The stamp is the
     * version; a fresh token always carries the current one.
     *
     * Returning null makes Auth.js clear the session cookie.
     *
     * This costs one indexed lookup per auth() call — middleware and every
     * Server Component — so the JWT is no longer stateless. That is the price of
     * revocation on a JWT, accepted deliberately (see the spec).
     */
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.uid = user.id;
        token.pwc = (user as { pwc?: string }).pwc ?? "0";
        return token;
      }
      const uid = Number(token.uid);
      if (!uid) return token;
      const [row] = await db
        .select({ pwc: users.passwordChangedAt })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);
      // Deleted user → nothing to authorise.
      if (!row) return null;
      if (String(row.pwc?.getTime() ?? 0) !== String(token.pwc ?? "0")) return null;
      return token;
    },
```

Note the callback becomes `async`. `db`, `users` and `eq` are already imported in this file.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean. If `token.pwc` complains, the token is indexable — do not add a module augmentation unless `tsc` demands it; report instead.

- [ ] **Step 4: Verify in the browser — REQUIRED, this is the task**

Start the dev server via the Browser pane (`preview_start`; never Bash). Credentials (synthetic, local DB only): `verify-admin@test.local` / `Verify@12345`, and `verify-delivery@test.local` / `Verify@12345`.

**⚠ Only ever reset `verify-delivery@test.local`. Never a real staff account.** Leave it on `Verify@12345` at the end so it stays usable.

Verify and report ACTUAL observations:

1. **The revocation.** Sign in as `verify-delivery@test.local`, confirm you reach a page. In a second tab sign in as `verify-admin@test.local` and reset verify-delivery's password (to `Verify@12345`). Back in the first context, navigate — **it must bounce to `/login`**.
2. **The loop that isn't — the check that matters.** Immediately sign in as `verify-delivery@test.local` with the new password and navigate two or three pages. The session **must survive**. An `iat`-based implementation passes step 1 and fails here, and failing here means nobody can log in at all.
3. **Nobody else is logged out.** Your `verify-admin` session (never reset) still works — the NULL stamp path.
4. `read_console_messages` → no errors.

Stop the preview server afterward, before running any DB tests.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/config.ts
git commit -m "feat(auth): revoke sessions when the password changes

The JWT carries the user's password stamp from sign-in; the jwt callback
re-reads it each request and returns null on a mismatch, which makes Auth.js
clear the cookie.

Equality, never a comparison against iat: iat is floored to seconds while the
stamp is milliseconds, so a token issued in the same second as a reset would
invalidate itself — an infinite login loop.

Costs one indexed lookup per auth() call, so the JWT is no longer stateless.
That is the price of revocation here: Auth.js refuses database sessions for
credentials-only providers (assert.js:114)."
```

---

### Task 4: Full verification

- [ ] **Step 1:** `npm test` — expect the pre-existing `lostCount` failure only. Stop the dev server first.
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` — lint must report **33 problems (3 errors, 30 warnings)**, identical to `main`'s baseline. More than that is yours.
- [ ] **Step 3:** `npm run build` — must succeed.
- [ ] **Step 4:** Confirm `git status` shows ONLY the user's pre-existing `scripts/reset-db.ts` (modified), `app/api/ping/`, `vercel.json` — untouched and unstaged.
