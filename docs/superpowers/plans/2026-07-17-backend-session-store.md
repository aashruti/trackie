# Backend Session Store + Revocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store sessions in the backend, check each one per request, and delete them on password change — so a reset locks out an intruder instead of merely recovering a forgotten password. Plus an admin **Sign out everywhere** that needs no password change.

**Architecture:** Auth.js keeps issuing JWTs (it insists on that for Credentials), but each token carries a `sid` we mint. We own `auth_sessions`; the `jwt` callback looks the row up every request and returns `null` when it's gone, which makes Auth.js clear the cookie.

**Tech Stack:** Auth.js v5 (`next-auth@5.0.0-beta.31`), Next.js App Router, Drizzle, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-session-revocation-on-password-change-design.md` — read it, especially §2 (what Auth.js does and doesn't block) and §4 (rows leak, knowingly).

---

## Background an engineer needs

**Do NOT set `session: { strategy: "database" }`.** Auth.js throws `UnsupportedStrategy` for credentials-only providers (`@auth/core/lib/utils/assert.js:114`) and **nobody can log in**. That blocks only Auth.js's *own* adapter-managed store — it does not stop us owning a table and checking it ourselves. That's what this builds.

**The two hooks, both verified:**
- `jwt` callback is async and returns `Awaitable<JWT | null>` (`@auth/core/index.d.ts:331`); `null` → `sessionStore.clean()` (`@auth/core/lib/actions/session.js:54`)
- `events.signOut` gets `{ token }` under the JWT strategy (`@auth/core/index.d.ts:362`)

**No `expires_at` column, deliberately.** Auth.js verifies the JWT's own `exp` *before* the callback runs, so an expired token never reaches our check and a stale row can't resurrect it. Storing an expiry would duplicate that, and keeping it correct under Auth.js's rolling refresh would cost a write per request. The row exists only to enable revocation. (Rows therefore leak on abandoned sessions — known, accepted, swept later; see spec §4.)

**House patterns to mirror:**
- `lib/dal/user-admin.ts` — `assertSuperAdmin` (`:9`) is a private helper; `resetUserPassword` (`:84`) calls it **first**, before any DB read.
- `app/(app)/admin/users/actions.ts` — `resetUserPasswordAction` is the `{ ok, error }` shape to copy.
- `components/admin/users-admin.tsx` — `UserCard` has a `self: boolean` prop, `!self && (…)` guards, and a `confirm()` before Delete (`remove()`).
- `drizzle/0011_account_groups.sql` — idempotent migration style.

**Project rules (CLAUDE.md — hard):** every schema change is a Drizzle migration file in `drizzle/` + its `drizzle/meta/_journal.json` entry, then `npx tsx scripts/db-migrate.ts`. **Never** mutate the DB ad-hoc. **Never** `CREATE TYPE IF NOT EXISTS`.

**⚠ This database holds REAL Datagami staff records** (18 real accounts). Never run a seed or reset script. Never mutate a real user. Tests create their own throwaway users and delete them in `afterAll` — `lib/dal/user-admin.test.ts` already does exactly this.

**Dev/test gotchas.** **Stop any dev server before running DB tests** or you hit `PostgresError: sorry, too many clients already` — connection exhaustion, not a real failure. Use the Browser pane's `preview_list`/`preview_stop`; **never use Bash to start a dev server** (use `preview_start`). Plain `tsx` won't resolve `server-only` — DB probes must be `*.test.ts` via vitest. `npm test` has ONE pre-existing failure in `lib/board/constants.test.ts` (`lostCount`) that also fails on `main` — ignore it. Lint baseline on `main` is exactly `33 problems (3 errors, 30 warnings)`.

---

## File Structure

**Create:** `drizzle/0013_auth_sessions.sql`, `lib/dal/sessions.ts`, `lib/dal/sessions.test.ts`
**Modify:** `drizzle/meta/_journal.json`, `lib/db/schema.ts`, `lib/auth/config.ts`, `lib/dal/user-admin.ts`, `lib/dal/user-admin.test.ts`, `app/(app)/profile/actions.ts`, `app/(app)/admin/users/actions.ts`, `components/admin/users-admin.tsx`

**Never touch:** `scripts/reset-db.ts`, `app/api/ping/`, `vercel.json` — the user's uncommitted work. Never stage them.

---

### Task 1: Table + DAL

**Files:** Create `drizzle/0013_auth_sessions.sql`, `lib/dal/sessions.ts`, `lib/dal/sessions.test.ts`; modify `drizzle/meta/_journal.json`, `lib/db/schema.ts`

- [ ] **Step 1: Migration**

`drizzle/0013_auth_sessions.sql`:

```sql
-- Backend session store. Auth.js still issues the JWT (it requires the jwt
-- strategy for Credentials providers), but each token carries a `sid` and the
-- jwt callback checks the row here every request — so deleting rows revokes
-- sessions. Password change deletes every row for that user.
-- No expires_at: Auth.js verifies the JWT's own exp before our callback runs,
-- so a stale row can never resurrect an expired token.
-- Spec: docs/superpowers/specs/2026-07-17-session-revocation-on-password-change-design.md
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
```

- [ ] **Step 2: Journal entry**

Append to `entries` in `drizzle/meta/_journal.json` after `0011_account_groups` (mind the comma):

```json
    {
      "idx": 13,
      "version": "7",
      "when": 1784018300000,
      "tag": "0013_auth_sessions",
      "breakpoints": true
    }
```

(`idx` 12 is skipped — a superseded draft claimed it and never shipped.)

- [ ] **Step 3: Schema**

In `lib/db/schema.ts`, after `users` (it references `users.id`):

```ts
/**
 * One row per signed-in session. The JWT carries this row's id as `sid`; the
 * auth jwt callback checks it every request, so deleting a row revokes that
 * session on its next request.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_id_idx").on(t.userId)],
);
```

Add `index` to the `drizzle-orm/pg-core` import if absent.

- [ ] **Step 4: Run the migration**

Run: `npx tsx scripts/db-migrate.ts`
Expected: applies `0013_auth_sessions`.

- [ ] **Step 5: Write the failing tests**

`lib/dal/sessions.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createSession, sessionExists, deleteSession, deleteUserSessions } from "./sessions";
import { createUser, deleteUser } from "./user-admin";

const SUPER = { id: 1, role: "super-admin" as const };

describe("sessions", () => {
  const made: number[] = [];

  async function throwaway(email: string) {
    const u = await createUser(SUPER, {
      name: "Session Test",
      email,
      password: "throwaway1",
      role: "viewer",
    });
    made.push(u.id);
    return u.id;
  }

  it("creates a session that exists, and deletes it", async () => {
    const uid = await throwaway("sess-a@datagami.local");
    const sid = await createSession(uid);
    expect(await sessionExists(sid)).toBe(true);
    await deleteSession(sid);
    expect(await sessionExists(sid)).toBe(false);
  });

  it("mints unguessable, unique ids", async () => {
    const uid = await throwaway("sess-b@datagami.local");
    const a = await createSession(uid);
    const b = await createSession(uid);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("deleteUserSessions kills all of one user's and leaves another's alone", async () => {
    const mine = await throwaway("sess-mine@datagami.local");
    const theirs = await throwaway("sess-theirs@datagami.local");
    const m1 = await createSession(mine);
    const m2 = await createSession(mine);
    const t1 = await createSession(theirs);

    const killed = await deleteUserSessions(mine);
    expect(killed).toBe(2);
    expect(await sessionExists(m1)).toBe(false);
    expect(await sessionExists(m2)).toBe(false);
    // The assertion that matters: a missing `WHERE user_id` would sign out the
    // whole company on one password reset.
    expect(await sessionExists(t1)).toBe(true);
  });

  it("deleting a user cascades their sessions away", async () => {
    const uid = await throwaway("sess-cascade@datagami.local");
    const sid = await createSession(uid);
    await deleteUser(SUPER, uid);
    made.splice(made.indexOf(uid), 1);
    expect(await sessionExists(sid)).toBe(false);
  });

  it("sessionExists is false for an unknown id", async () => {
    expect(await sessionExists("no-such-session-id")).toBe(false);
  });

  afterAll(async () => {
    for (const id of made) await deleteUser(SUPER, id);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run lib/dal/sessions.test.ts`
Expected: FAIL — cannot resolve `./sessions`.

- [ ] **Step 7: Write the DAL**

`lib/dal/sessions.ts`:

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authSessions } from "@/lib/db/schema";

/**
 * The backend session store. Auth.js issues a JWT carrying this row's id as
 * `sid`; the jwt callback checks the row on every request, so deleting a row
 * revokes that session.
 *
 * This is the ONLY module that touches auth_sessions.
 */

/** Mint a session row and return its id, to be carried in the JWT as `sid`. */
export async function createSession(userId: number): Promise<string> {
  // Unguessable: the sid is inside a signed JWT, but a predictable id would let
  // a leaked token be swapped for someone else's live session.
  const id = crypto.randomUUID();
  await db.insert(authSessions).values({ id, userId });
  return id;
}

/** Is this session still live? Called on every auth() — hence the PK lookup. */
export async function sessionExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.id, id))
    .limit(1);
  return !!row;
}

/** Clean sign-out. */
export async function deleteSession(id: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.id, id));
}

/** Revoke every session for one user. Returns how many ended. */
export async function deleteUserSessions(userId: number): Promise<number> {
  const gone = await db
    .delete(authSessions)
    .where(eq(authSessions.userId, userId))
    .returning({ id: authSessions.id });
  return gone.length;
}
```

If `and` is unused, drop it from the import.

- [ ] **Step 8: Verify and commit**

Run: `npx vitest run lib/dal/sessions.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests); clean. Confirm no `sess-*@datagami.local` rows survive.

```bash
git add drizzle/0013_auth_sessions.sql drizzle/meta/_journal.json lib/db/schema.ts lib/dal/sessions.ts lib/dal/sessions.test.ts
git commit -m "feat(auth): backend session store

One row per sign-in. The JWT carries the row id as sid; deleting the row
revokes that session. Auth.js keeps issuing JWTs — it refuses database
sessions for credentials-only providers (assert.js:114) — but nothing stops
us owning the table and checking it ourselves.

No expires_at: Auth.js verifies the JWT's own exp before our callback runs,
so a stale row cannot resurrect an expired token."
```

---

### Task 2: Wire it into auth

**Files:** Modify `lib/auth/config.ts`

- [ ] **Step 1: Mint on sign-in, check on every request**

Replace the `jwt` callback and add `events`:

```ts
    /**
     * Revocation. On sign-in we mint a session row and record its id on the
     * token; every later request checks the row still exists. Returning null
     * makes Auth.js clear the cookie (@auth/core/lib/actions/session.js:54).
     *
     * This costs one primary-key lookup per auth() call — middleware and every
     * Server Component — so the JWT is no longer stateless. That is the price of
     * revocation, accepted deliberately (see the spec).
     */
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.uid = user.id;
        token.sid = await createSession(Number(user.id));
        return token;
      }
      const sid = token.sid as string | undefined;
      // No sid → a token minted before this shipped. Reject it: it predates the
      // session store and cannot be revoked, so honouring it would leave a hole
      // open for the life of the old token.
      if (!sid) return null;

      let live: boolean;
      try {
        live = await sessionExists(sid);
      } catch (e) {
        // FAIL OPEN — load-bearing. Auth.js calls this callback inside a try and
        // its catch clears the session cookie (actions/session.js:58), so it
        // cannot tell "the DB was unreachable" from "this token is forged".
        // Letting this throw would sign out EVERY user on a transient DB error —
        // and Neon suspends by design on this stack (hence /api/ping), so that is
        // a recurring event, not a hypothetical. A revoked session surviving a
        // brief outage is the far smaller harm: revocation is delayed, not lost.
        console.error("[auth] session check failed; allowing through:", e);
        return token;
      }
      if (!live) return null; // definitively revoked
      return token;
    },
```

and, as a sibling of `callbacks` on the `NextAuth({...})` object:

```ts
  events: {
    // Clean sign-out: drop the row rather than leaving it to leak (spec §4).
    signOut: async (message) => {
      const sid = "token" in message ? (message.token?.sid as string | undefined) : undefined;
      if (sid) await deleteSession(sid);
    },
  },
```

Import at the top: `import { createSession, sessionExists, deleteSession } from "@/lib/dal/sessions";`

- [ ] **Step 2: Prove the fail-open guard actually works**

A guard nobody has watched fail is a hope, not a guard. Verify it two ways and paste both:

1. **Unit-level.** Temporarily make `sessionExists` throw unconditionally (`throw new Error("simulated DB outage")` as its first line). Run the app in the browser signed in, navigate → **you must stay signed in**, and `preview_logs` must show `[auth] session check failed; allowing through`. Revert.
2. **Prove the danger was real.** With `sessionExists` still throwing, temporarily remove the try/catch so the error propagates → navigating must **bounce you to `/login`**, demonstrating that Auth.js's catch clears the cookie on a DB error. Restore the try/catch and confirm `git diff lib/dal/sessions.ts` is empty.

Report both observations. If step 2 does *not* log you out, the premise for the guard is wrong — stop and tell me rather than keeping a guard that guards nothing.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean. If `token.sid` errors, report rather than adding a module augmentation unprompted.

> **Note the deploy consequence, and don't paper over it:** rejecting sid-less tokens means **everyone currently signed in is logged out once** when this deploys. That is intended — an un-revocable token is exactly what this removes — but it must be stated in the PR, not discovered.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/config.ts
git commit -m "feat(auth): check the session row on every request

Sign-in mints a row and puts its id on the token; every later request checks
it and returns null when it is gone, which makes Auth.js clear the cookie.
events.signOut drops the row on a clean logout.

Tokens with no sid are rejected: they predate the store and cannot be
revoked. Everyone signed in is logged out once on deploy — intended."
```

---

### Task 3: Revoke on password change

**Files:** Modify `lib/dal/user-admin.ts`, `app/(app)/profile/actions.ts`, `lib/dal/user-admin.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe("user-admin", …)` in `lib/dal/user-admin.test.ts` (import `createSession`, `sessionExists` from `./sessions`):

```ts
  it("a password reset ends the target's sessions", async () => {
    const u = await createUser(SUPER, {
      name: "Revoke Target",
      email: "revoke-target@datagami.local",
      password: "oldpassword1",
      role: "viewer",
    });
    try {
      const sid = await createSession(u.id);
      expect(await sessionExists(sid)).toBe(true);
      await resetUserPassword(SUPER, u.id, "brandnewpass1");
      // The whole point: the reset locks out anyone already signed in.
      expect(await sessionExists(sid)).toBe(false);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/dal/user-admin.test.ts`
Expected: FAIL — `expected true to be false`; nothing revokes yet.

- [ ] **Step 3: Revoke in `resetUserPassword`**

In `lib/dal/user-admin.ts`, after the password update:

```ts
  const ended = await deleteUserSessions(userId);
  console.info(`[security] password reset by user ${actor.id} for user ${userId} (${ended} sessions ended)`);
```

(replacing the existing `console.info`), and **delete the "NOTE: this does NOT sign the target out…" paragraph** from its docblock, replacing it with:

```
 * Signs the target out everywhere: every session row for them is deleted, so
 * each of their devices is rejected on its next request. This is what makes the
 * feature usable for a compromised account, not just a forgotten password.
```

Import `deleteUserSessions` from `./sessions`.

- [ ] **Step 4: Revoke on self-change**

In `app/(app)/profile/actions.ts`, after the password update:

```ts
  // Ends every session including this one, so the user lands on /login. Chosen
  // deliberately: someone who suspects compromise can evict an intruder without
  // waiting for an admin.
  await deleteUserSessions(userId);
```

Import `deleteUserSessions` from `@/lib/dal/sessions`.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run lib/dal/user-admin.test.ts lib/dal/sessions.test.ts && npx tsc --noEmit`
Expected: PASS; clean. No `revoke-target@datagami.local` row survives.

```bash
git add lib/dal/user-admin.ts "app/(app)/profile/actions.ts" lib/dal/user-admin.test.ts
git commit -m "feat(auth): a password change ends that user's sessions

Both paths revoke: an admin reset and a profile self-change. Self-change ends
the current session too, so a user who suspects compromise can evict an
intruder without waiting for an admin.

Deletes resetUserPassword's 'does NOT sign the target out' note: it now does."
```

---

### Task 4: Admin "Sign out everywhere"

**Files:** Modify `lib/dal/user-admin.ts`, `lib/dal/user-admin.test.ts`, `app/(app)/admin/users/actions.ts`, `components/admin/users-admin.tsx`

This is the case the table exists for: evicting someone **without** changing their password.

- [ ] **Step 1: Write the failing test**

```ts
  it("sign out everywhere ends sessions without touching the password", async () => {
    const u = await createUser(SUPER, {
      name: "Kick Target",
      email: "kick-target@datagami.local",
      password: "keepthispass1",
      role: "viewer",
    });
    try {
      const sid = await createSession(u.id);
      const ended = await signOutUserEverywhere(SUPER, u.id);
      expect(ended).toBe(1);
      expect(await sessionExists(sid)).toBe(false);

      // The password is untouched — that is the whole distinction from a reset.
      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      expect(await verifyPassword("keepthispass1", row.passwordHash)).toBe(true);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("only a super admin can sign someone out everywhere", async () => {
    for (const role of ["admin", "hr", "delivery", "viewer"] as const) {
      await expect(signOutUserEverywhere({ id: 2, role }, 3)).rejects.toThrow(/Super Admin/i);
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/dal/user-admin.test.ts`
Expected: FAIL — `signOutUserEverywhere is not a function`.

- [ ] **Step 3: The DAL**

In `lib/dal/user-admin.ts`:

```ts
/**
 * End every session for a user WITHOUT changing their password — the case a
 * reset cannot serve when you only want someone out, not locked out.
 *
 * Self is allowed, unlike resetUserPassword: signing yourself out everywhere is
 * recoverable (sign in again), not a lockout risk.
 */
export async function signOutUserEverywhere(
  actor: SessionUser,
  userId: number,
): Promise<number> {
  assertSuperAdmin(actor);
  const ended = await deleteUserSessions(userId);
  console.info(`[security] sessions ended by user ${actor.id} for user ${userId} (${ended})`);
  return ended;
}
```

- [ ] **Step 4: The action**

In `app/(app)/admin/users/actions.ts` (import `signOutUserEverywhere`):

```ts
export async function signOutUserEverywhereAction(userId: number) {
  try {
    const ended = await signOutUserEverywhere(await actor(), userId);
    revalidatePath("/admin/users");
    return { ok: true as const, ended };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to sign out sessions" };
  }
}
```

- [ ] **Step 5: The UI**

In `components/admin/users-admin.tsx`, import the action, then inside `UserCard` add beside `remove()`:

```tsx
  function signOutEverywhere() {
    if (!confirm(`Sign ${user.name} out of every device? They'll need to sign in again.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await signOutUserEverywhereAction(user.id);
      if (res.ok) setPwDone(false);
      else setError(res.error);
    });
  }
```

and a button next to "Reset password" (note: **no `!self` guard** — signing yourself out is allowed):

```tsx
          <button
            onClick={signOutEverywhere}
            disabled={pending}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Sign out everywhere
          </button>
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run lib/dal && npx tsc --noEmit && npx eslint components/admin/users-admin.tsx "app/(app)/admin/users/actions.ts" lib/dal/user-admin.ts`
Expected: PASS; clean.

```bash
git add lib/dal/user-admin.ts lib/dal/user-admin.test.ts "app/(app)/admin/users/actions.ts" components/admin/users-admin.tsx
git commit -m "feat(admin): sign a user out of every device

Evicts someone without changing their password — the case a reset cannot
serve when you want them out, not locked out. Super admin only; self is
allowed, since signing yourself out is recoverable."
```

---

### Task 5: Browser verification — REQUIRED

**Files:** none.

Start the dev server via the Browser pane (`preview_start`; **never Bash**). Credentials (synthetic, local DB only): `verify-admin@test.local` / `Verify@12345`, `verify-delivery@test.local` / `Verify@12345`.

**⚠ Only ever act on `verify-delivery@test.local`. Never a real staff account.** Leave its password on `Verify@12345`.

Report ACTUAL observations for each:

- [ ] **1. Everyone is logged out once.** Your existing session (minted before this branch) has no `sid` → the first request must bounce to `/login`. This is the intended one-time cost.
- [ ] **2. Sign-in works and sticks.** Sign in as `verify-admin@test.local`, navigate 3–4 pages. The session must survive — proving the check doesn't eat fresh sessions.
- [ ] **3. Revocation on reset.** Sign in as `verify-delivery` (a second browser context/tab). As `verify-admin`, reset verify-delivery's password to `Verify@12345`. Back as verify-delivery, navigate → **must bounce to `/login`**.
- [ ] **4. Others unaffected.** Your `verify-admin` session still works after step 3 — proving `WHERE user_id` scoping holds live.
- [ ] **5. Sign out everywhere.** Sign `verify-delivery` in again, then hit "Sign out everywhere" on its row as verify-admin. verify-delivery's next request → `/login`. Confirm its password still works by signing in again — that's the distinction from a reset.
- [ ] **6. Clean sign-out drops the row.** Sign out normally; confirm via a throwaway vitest probe that no `auth_sessions` row remains for that user. Delete the probe.
- [ ] **7.** `read_console_messages` → no errors. `preview_logs` shows the `[security]` lines.

Stop the preview server afterward, before any DB tests.

---

### Task 6: Full gates

- [ ] `npm test` — expect only the pre-existing `lostCount` failure. Stop the dev server first.
- [ ] `npx tsc --noEmit && npm run lint` — lint must be exactly `33 problems (3 errors, 30 warnings)`, `main`'s baseline.
- [ ] `npm run build` — must succeed.
- [ ] `git status` shows ONLY the user's `scripts/reset-db.ts` (modified), `app/api/ping/`, `vercel.json` — untouched, unstaged.
