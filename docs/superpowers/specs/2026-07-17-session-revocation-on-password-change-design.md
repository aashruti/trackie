# Session Revocation on Password Change

**Date:** 2026-07-17
**Status:** Approved for implementation (user confirmed: `passwordChangedAt` + a JWT-callback check;
the check runs everywhere `auth()` runs; self-change logs out everywhere too)
**Depends on:** `resetUserPassword` (PR #16, merged)

## 1. Problem

`resetUserPassword` currently carries this comment, and it is accurate:

> NOTE: this does NOT sign the target out. Sessions are JWTs and cannot be revoked without a
> denylist, so an existing session survives the reset.

So the reset fixes **"Farzana forgot her password"** but not **"this account is compromised, lock
them out"** — the intruder's session keeps working. This closes that.

## 2. Why not database sessions — the blocker, recorded

The user's first choice was `session: { strategy: "database" }`. **Auth.js refuses it.**
`node_modules/@auth/core/lib/utils/assert.js:114`:

```js
if (hasCredentials) {
  const dbStrategy = options.session?.strategy === "database";
  const onlyCredentials = !options.providers.some((p) => p.type !== "credentials");
  if (dbStrategy && onlyCredentials) {
    return new UnsupportedStrategy("Signing in with credentials only supported if JWT strategy is enabled");
  }
}
```

Trackie has exactly one provider — `Credentials` (`lib/auth/config.ts:12`) — so `onlyCredentials` is
true and setting `"database"` throws at startup: **nobody could log in at all**. This is not a version
quirk and no adapter fixes it. The reason is structural: Credentials users are authenticated against
our own `users` table rather than created through an adapter, so Auth.js has no adapter-managed row
to hang a session off.

Adding a second provider would dodge the `onlyCredentials` condition, but Credentials users still
would not get database sessions — it does not actually solve it.

## 3. The mechanism — and the login-loop trap it avoids

Auth.js supports invalidation: the `jwt` callback returns `Awaitable<JWT | null>`
(`@auth/core/index.d.ts:331`), and returning `null` makes it clear the session cookie —
`@auth/core/lib/actions/session.js:54`:

```js
if (token !== null) { /* re-sign and refresh the cookie */ }
else { response.cookies?.push(...sessionStore.clean()); }
```

**The obvious implementation is broken.** The textbook version compares `passwordChangedAt` against
the token's `iat`. JWT `iat` is in **seconds** (floored); the stamp is in **milliseconds**. Reset at
`10:00:00.700`, user signs in at `10:00:00.900` → the fresh token's `iat` is `10:00:00.000`, which is
*earlier* than the stamp → the brand-new token invalidates itself on its first request. The user logs
in, gets bounced, logs in, gets bounced. Forever.

**So we never compare clocks.** The stamp *is* the version:

- `authorize()` already SELECTs the whole user row (`config.ts:18`), so it returns `pwc` — the stamp
  in ms, or `0` when null — at **no extra query cost**.
- The `jwt` callback stores `token.pwc` at sign-in (`user` is present only then).
- On later requests it reads the *current* stamp and compares for **equality**. Mismatch → `null`.

No clock arithmetic, no granularity window, no loop: a fresh token always carries the current stamp
and always matches.

## 4. The cost, stated plainly

The `jwt` callback runs on **every** `auth()` call — `proxy.ts` middleware and every Server
Component. Checking the stamp means one indexed lookup per call, so **the JWT stops being
stateless**. That is the price of revocation on a JWT, accepted deliberately: at 18 users, on pages
already issuing 4+ queries, it is noise.

The user chose this over a middleware-only check, which would have halved the queries but left a real
hole — a revoked session could still complete work in a Server Action or route handler that
middleware does not cover.

## 5. Modules

**Migration `0012_password_changed_at.sql`** — one **nullable** timestamp on `users`. Nullable is
load-bearing: every existing user has no stamp, so **nobody is logged out on deploy**. Follows the
house idempotent style (`ADD COLUMN IF NOT EXISTS`, cf. `0011_account_groups.sql`), plus its
`drizzle/meta/_journal.json` entry per the project's migration rules.

**`lib/db/schema.ts`** — `passwordChangedAt: timestamp("password_changed_at")`.

**`lib/auth/config.ts`** — the only change to how anyone signs in:
- `authorize` returns `pwc: String(u.passwordChangedAt?.getTime() ?? 0)`
- `jwt` callback: on sign-in (`user` present) store `token.pwc`; otherwise read the current stamp for
  `token.uid` and return `null` on mismatch.

**`lib/dal/user-admin.ts`** — `resetUserPassword` sets `passwordChangedAt: new Date()` alongside the
hash, and its "does NOT sign the target out" comment is **deleted**, because it no longer will.

**`app/(app)/profile/actions.ts`** — the self-change sets it too (§6).

## 6. Self-change logs out everywhere too

Per the user's answer. A user who suspects compromise can then evict an intruder **without needing an
admin** — which is the main reason people change passwords urgently. The cost: they are bounced to
`/login` right after changing their own password and must sign in again. Simple, safe, and the
behaviour most apps have.

## 7. What this does NOT do

- **No per-device logout.** The stamp is per user, so revocation is all-or-nothing. Distinguishing
  sessions needs a real session table, which §2 shows Auth.js will not give us here.
- **No admin "sign out everywhere" button.** Revocation is a side effect of changing the password.
- The window is one request: a revoked token works until its next `auth()` call, which is immediate
  in practice.

## 8. Testing

The stamping is DAL behaviour and testable (`lib/dal/user-admin.test.ts`, real local Postgres):
- `resetUserPassword` sets `passwordChangedAt`, and it moves forward on a second reset
- self-change via profile sets it too

The `jwt` callback is Auth.js-internal and has no test harness here (no session mocking). Its two
behaviours are verified **in the browser**, which is the only honest way:
- **the revocation:** sign in as A in one context, reset A's password as an admin, confirm A's next
  request bounces to `/login`
- **the loop that isn't:** immediately sign in as A with the new password and navigate — a fresh
  token must survive, proving the equality check avoids the `iat` trap that would otherwise make
  login unusable

The second is the one that matters: an `iat`-based implementation passes the first test and fails the
second, and failing it means **nobody can log in**.

## 9. Out of scope

- Database sessions (§2 — blocked by Auth.js).
- Hand-rolled sessions outside Auth.js.
- Per-device logout / session listing.
- An audit table (`resetUserPassword` still `console.info`s each reset).
