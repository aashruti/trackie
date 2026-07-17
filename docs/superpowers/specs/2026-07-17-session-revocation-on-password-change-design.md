# Backend Session Store + Revocation

**Date:** 2026-07-17
**Status:** Approved for implementation (user's design: store sessions in the backend, check validity
per request, delete them on password change)
**Depends on:** `resetUserPassword` (PR #16, merged)

> **Supersedes an earlier draft of this file**, which specified a `passwordChangedAt` stamp on
> `users` instead of a session table. That draft was not the user's design — it was substituted
> without flagging the divergence, on the mistaken belief that a real session store was blocked here.
> It isn't (§2). The stamp approach is recorded in §7 as the rejected alternative.

## 1. Problem

`resetUserPassword` carries this note, and it is accurate:

> NOTE: this does NOT sign the target out. Sessions are JWTs and cannot be revoked without a
> denylist, so an existing session survives the reset.

A reset therefore recovers a forgotten password but does **not** lock out an intruder. There is also
no way to see who is signed in, and no way to sign anyone out without changing their password.

## 2. What Auth.js does and does not block — the distinction that was blurred

Auth.js refuses `session: { strategy: "database" }` for credentials-only providers
(`@auth/core/lib/utils/assert.js:114`) — Trackie has exactly one provider, `Credentials`, so setting
it throws `UnsupportedStrategy` at startup and **nobody can log in**. That much is real and verified.

**But that only blocks Auth.js's *own*, adapter-managed session store.** It does not stop us keeping
our own table and checking it ourselves. Auth.js goes on issuing JWTs (which it insists on for
Credentials); the JWT simply carries a session id we control, and we own the row. Both hooks needed
are present and verified:

- the `jwt` callback is async and returns `Awaitable<JWT | null>` (`@auth/core/index.d.ts:331`);
  returning `null` makes Auth.js clear the cookie (`@auth/core/lib/actions/session.js:54`)
- `events.signOut` receives `{ token }` under the JWT strategy (`@auth/core/index.d.ts:362`), so a
  clean logout can delete its row

This is a **hybrid**, not a replacement: Auth.js keeps sign-in, cookies, and JWT expiry; we own
revocation.

## 3. Design

**`auth_sessions`** — one row per sign-in:

| column | |
| --- | --- |
| `id` | text PK — an unguessable `crypto.randomUUID()`, carried in the JWT as `sid` |
| `user_id` | integer NOT NULL → `users.id` **ON DELETE CASCADE** (deleting a user drops their sessions) |
| `created_at` | timestamp NOT NULL default now — for listing "signed in since" |

Indexed on `user_id`, because every revocation is `WHERE user_id = ?`.

**Flow:**
- **sign-in** (`jwt` callback with `user` present): mint a `sid`, insert the row, put `sid` on the token.
- **every later request** (`jwt` callback, no `user`): `SELECT 1 FROM auth_sessions WHERE id = sid`.
  Missing → `return null` → Auth.js clears the cookie. This is the one indexed read per `auth()` call.
- **sign-out** (`events.signOut`): delete the row for that `sid`.
- **password change** (admin reset *or* profile self-change): `DELETE … WHERE user_id = ?` — every
  session for that user dies on its next request.

**No `expires_at` column, deliberately.** Auth.js verifies the JWT's own `exp` **before** the `jwt`
callback runs, so an expired token never reaches our check — the row cannot resurrect it. Storing an
expiry would only duplicate that, and keeping it accurate under Auth.js's *rolling* refresh would
cost a write per request. The row exists solely to enable revocation.

## 3a. The session check MUST fail open — this is the sharpest edge here

`callbacks.jwt` is invoked **inside a `try`** in `@auth/core/lib/actions/session.js:27-62`, and the
`catch` is:

```js
catch (e) {
    logger.error(new JWTSessionError(e));
    // If the JWT is not verifiable remove the broken session cookie(s).
    response.cookies?.push(...sessionStore.clean());
}
```

Auth.js cannot distinguish "your database was unreachable" from "this token is forged", so **any
throw out of our check clears the session cookie**. Left unguarded, a transient DB error signs out
**every user at once**.

That is not hypothetical on this stack. `sorry, too many clients already` occurred during
development, and `app/api/ping` exists specifically because **Neon's free tier suspends compute after
5 minutes idle** — cold starts and connection failures are designed-in, recurring events here. The
naive implementation would sign out the company on every hiccup: strictly worse than the problem
being solved.

**The check FAILS CLOSED — the user's explicit decision, made with the consequence stated.**

No try/catch: a DB error propagates, Auth.js's catch clears the cookie, and the user is signed out.
The session store is treated as authoritative — if we cannot confirm a session is live, it is not
honoured.

```ts
// No guard, deliberately. If the store cannot be reached, the session is not
// honoured. A DB error therefore signs the user out — and because Auth.js's
// catch cannot distinguish an outage from a forged token, a wide outage signs
// out everyone at once. Accepted: the store is the source of truth for whether
// a session is live, and a revoked session must never act.
if (!(await sessionExists(sid))) return null;
return token;
```

**The accepted consequence, recorded so nobody rediscovers it as a bug:** a transient database error
signs out every logged-in user. On this stack that is a *when*, not an *if* — `sorry, too many
clients already` occurred during development, and `app/api/ping` exists because Neon's free tier
suspends compute after 5 minutes idle, so cold starts are designed in. **If users report being
randomly logged out, this is why, and it is working as specified.**

The alternative considered and rejected by the user was failing open (log the error, honour the
token), which delays revocation during an outage rather than losing it. The user chose strict
correctness of revocation over availability.

This constraint is inherent to checking anything in the `jwt` callback; the rejected stamp approach
(§7) would have faced the identical choice.

## 4. Known limitation: rows leak

A session abandoned without signing out (browser closed) leaves an orphan row forever. It is
**unusable** — its JWT expires independently — but it is never collected.

At 18 users this is a few hundred rows a year: trivial for Postgres, and lookups are by primary key.
A sweep is a **follow-up**, not part of this change. It is stated here rather than discovered later.
`vercel.json` already runs a `/api/ping` cron every 4 minutes that could host one — but both that
file and `app/api/ping/` are currently the user's *uncommitted* work, so this design must not depend
on them.

## 5. The cost

The `jwt` callback runs on **every** `auth()` call — `proxy.ts` middleware and every Server
Component — so this adds one primary-key lookup per call and **the JWT stops being stateless**. That
is the price of revocation, accepted deliberately: at 18 users, on pages already issuing 4+ queries,
it is noise.

The user chose this over a middleware-only check, which would halve the queries but leave a real hole
— a revoked session could still act in a Server Action or route handler middleware does not cover.

## 6. Self-change signs you out everywhere too

Per the user's earlier answer. Someone who suspects compromise can then evict an intruder **without
waiting for an admin** — the main reason people change passwords urgently. Cost: they land on
`/login` right after changing their own password. Simple, safe, and what most apps do.

## 7. Rejected alternative: `passwordChangedAt` stamp

A nullable timestamp on `users`, baked into the JWT at sign-in and compared for equality each
request. Smaller — no table, no insert, no sign-out hook, no leak.

**Rejected** because it costs *exactly the same* one indexed read per request while delivering
strictly less: revocation is all-or-nothing per user, so no per-device sign-out, no "signed in on 3
devices", and no admin sign-out-everywhere without also changing the password. The only advantage was
size, which does not outweigh the capability gap.

Recorded because its one genuine insight must not be lost if anyone revisits it: **never compare the
stamp against the JWT's `iat`.** `iat` is floored to seconds and the stamp is milliseconds, so a
token minted in the same second as a reset looks older than the stamp and invalidates itself —
sign in, bounce, sign in, bounce, forever.

## 8. Modules

**Migration `0013_auth_sessions.sql`** — the table, FK and index, idempotent per house style
(`0011_account_groups.sql`), plus its `drizzle/meta/_journal.json` entry. *(0012 is unused — the
superseded draft never shipped one.)*

**`lib/db/schema.ts`** — `authSessions`.

**`lib/dal/sessions.ts`** *(new, `server-only`)* — the only module that touches the table:
`createSession(userId)`, `sessionExists(id)`, `deleteSession(id)`, `deleteUserSessions(userId)`.

**`lib/auth/config.ts`** — the `jwt` callback (mint/insert on sign-in; check-or-`null` after) and an
`events.signOut` that deletes the row. Sign-in itself is otherwise untouched.

**`lib/dal/user-admin.ts`** — `resetUserPassword` calls `deleteUserSessions`; its "does NOT sign the
target out" note is **deleted**, because it no longer will. Plus `signOutUserEverywhere(actor,
userId)` behind the same `assertSuperAdmin` gate (§8a).

**`app/(app)/admin/users/actions.ts`** + **`components/admin/users-admin.tsx`** — a per-row **Sign out
everywhere** control (§8a).

**`app/(app)/profile/actions.ts`** — the self-change calls `deleteUserSessions` too. Per the user's
choice this kills **every** session including the current one, so changing your own password bounces
you to `/login`. The table would allow sparing the current `sid`; the simpler all-or-nothing was
chosen deliberately.

### 8a. Admin "Sign out everywhere"

Evicts a user **without changing their password** — the case §7's rejected stamp approach could not
serve at all, and the main reason the table earns its keep.

- `signOutUserEverywhere(actor, userId)` — `assertSuperAdmin` first (before any DB read, matching
  `resetUserPassword`), then `deleteUserSessions(userId)`. Returns the number of sessions ended so
  the UI can say something true. `console.info`s the actor and target, like `resetUserPassword` —
  there is still no audit table.
- **Self is allowed here**, unlike password reset: signing yourself out of everywhere is a normal,
  recoverable act (you just sign in again), not a lockout risk. It ends the current session too.
- Action returns `{ ok, error }`; the UI control sits beside "Reset password" on the user row and
  confirms first, since it is disruptive and cannot be undone.

## 9. Testing

`lib/dal/sessions.test.ts` (real local Postgres): create → exists; delete → gone; `deleteUserSessions`
kills all of one user's and **leaves another user's alone** (the assertion that catches a missing
`WHERE user_id`); deleting a user cascades.

`lib/dal/user-admin.test.ts`: after `resetUserPassword`, that user has zero sessions.

The `jwt` callback is Auth.js-internal with no test harness here, so it is verified **in the browser**
— the only honest way:
1. **Revocation:** sign in as A; reset A's password as an admin; A's next request bounces to `/login`.
2. **Sign-in still works** immediately afterward, and survives several navigations — proving the
   check does not eat fresh sessions.
3. **B is unaffected** while A is revoked — proving the `WHERE user_id` scoping holds live, not just
   in tests.

## 10. Out of scope

- Sweeping orphan rows (§4).
- A session list UI ("signed in on 3 devices, since…"). `created_at` is stored for it, but nothing
  reads it yet.
- Sparing the current session on self-change (§8) — possible with this table, not chosen.
- Auth.js-managed database sessions (§2 — genuinely blocked).
