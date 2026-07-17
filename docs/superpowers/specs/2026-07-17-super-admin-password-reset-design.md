# Super Admin — Reset Another User's Password

**Date:** 2026-07-17
**Status:** Approved for implementation (user chose "admin types the new password" over an emailed
reset link; the four sub-decisions below were taken as recommended and stated explicitly)
**Depends on:** existing user admin (`lib/dal/user-admin.ts`, `app/(app)/admin/users`)

## 1. Problem

There is **no password reset flow in Trackie at all**. Changing a password requires already being
signed in (`app/(app)/profile/actions.ts`, which demands the current password). A user who forgets
their password is permanently locked out — nobody can help them.

This surfaced concretely: during a verification session no one could sign in to a local database
holding real staff accounts, because there was no way to recover an unknown password.

Scope: **a super admin resets another user's password.** Self-serve "Forgot password?" on the login
page is a different feature and is not in scope.

## 2. Approaches considered

**A. Super admin types the new password (CHOSEN — user's call).**
Matches the existing `createUser` precedent exactly (`lib/dal/user-admin.ts:42`), which already has a
super admin type a password behind `assertSuperAdmin`. No email dependency, no new page, works when
mail is down. *Cost, accepted:* the admin learns the password and must relay it over an out-of-band
channel (Slack/WhatsApp), where it persists.

**B. Emailed reset link; the user picks their own password.** Best practice — the admin never learns
the secret. ACS email is configured and works locally (`lib/email/notify.ts`), and the HMAC token
pattern already exists. *Rejected:* more surface (a new public page), and it strands the user if mail
fails or the address is wrong — and **no user's email is verified today** (`emailVerifiedAt` is unset
for every row). The codebase already treats email as best-effort (`createUserAction` wraps the send
in try/catch so it "never blocks creation"), which is a poor foundation for a recovery path.

**C. Generated temp password + forced change at next login.** *Rejected:* needs a
`mustChangePassword` column and login-flow changes for little gain over A — the admin still sees the
password and still relays it out-of-band.

### Security note on B, recorded because it is a trap for anyone revisiting this

If B is ever built, it must **not** reuse `makeVerifyToken`/`verifyVerifyToken`
(`lib/auth/email-verify.ts`). Those produce a payload of exactly `userId:email:exp` signed with
`AUTH_SECRET`. A reset token built the same way would be **indistinguishable in shape**, so any
email-verification link — which sits in inboxes, gets forwarded, and lands in mail logs, and is
deliberately low-stakes — could be replayed against the reset endpoint to seize the account. The
purpose must be bound into the signed payload.

## 3. Decisions

**Minimum length: 8 — and `createUser` is aligned to match.** The codebase currently disagrees with
itself: `createUser` demands 6 (`user-admin.ts:48`), `profile` demands 8
(`profile/actions.ts:48`). A new reset path must pick one, and picking 6 would make an admin-set
password weaker than a self-set one. Aligning `createUser` is a one-line change to a file this work
already touches.

**The field shows plain text, not a masked input.** This inverts the usual instinct deliberately:
this is not the admin's own secret, it is a value they must *read and relay*. Masking hides the thing
they need to transcribe, inviting typos that lock the user out, and forces a confirm field to
compensate. A visible field needs neither.

**A super admin cannot reset their own password here.** They use `/profile`, which requires the
current password. Without this, an unlocked super-admin laptop becomes a permanent takeover: an
attacker changes the password without knowing the old one. Small friction, real protection.

**Every reset is logged to the server console.** There is no audit table in the schema and building
one is out of scope — but a security-sensitive action leaving zero trace is not acceptable.
`console.info` with actor and target IDs is the honest minimum.

## 4. Limitation — states plainly when this feature does NOT help

**A reset does not log the target out.** Auth.js is configured `session: { strategy: "jwt" }`
(`lib/auth/config.ts:9`), and JWTs cannot be revoked without a denylist. The target's existing
session keeps working until the token expires.

So this fixes **"Farzana forgot her password"** — the intended case. It does **not** fix **"this
account is compromised, lock them out"**: the intruder's session survives the reset untouched.
Closing that needs a `passwordChangedAt` column plus a check in the JWT callback — a migration and an
auth change, deliberately out of scope. Anyone reaching for this feature during an incident needs to
know it will not do what they want.

## 5. Modules

**`lib/dal/user-admin.ts`** — new `resetUserPassword(actor, userId, newPassword)`:
- `assertSuperAdmin(actor)` (the existing private helper)
- reject `userId === actor.id` → "Change your own password from your profile"
- reject `newPassword.length < 8`
- reject an unknown `userId`
- `hashPassword` (existing bcrypt helper) → `db.update(users).set({ passwordHash })`
- `console.info` the actor and target ids

Also: `createUser`'s `< 6` becomes `< 8`, with its message updated.

**`app/(app)/admin/users/actions.ts`** — `resetUserPasswordAction(userId, password)`, mirroring the
four existing actions (`actor()`, call the DAL, `revalidatePath("/admin/users")`). Returns
`{ ok: true }` or a typed error, matching `profile/actions.ts`' `{ ok, error }` shape rather than
throwing — a too-short password is an expected error, not an exception.

**`components/admin/users-admin.tsx`** — a per-row "Reset password" control beside the existing
role/accounts/delete actions: a plain-text input plus a confirm button, hidden for the actor's own
row. Success and failure both surface inline.

No migration. No new page. No email.

## 6. Authorization

`assertSuperAdmin` is the same gate the other four user-admin operations use. `proxy.ts` already
bounces `viewer` from the whole `(app)` group. No new surface, no new role.

A super admin resetting *another* super admin is permitted — they are peers, and a super admin can
already delete users and change roles. `superAdminCount()` guards against removing the last super
admin; it is irrelevant here since a reset removes nobody.

## 7. Testing

`lib/dal/user-admin.test.ts` (integration, real local Postgres — the file already exists):
- a non-super-admin actor is rejected for every role (`admin`, `hr`, `delivery`, `viewer`)
- a password under 8 chars is rejected
- resetting your own id is rejected
- an unknown userId is rejected
- **the happy path is verified by behaviour, not by inspection:** after a reset, `verifyPassword(new, hash)`
  is true and `verifyPassword(old, hash)` is false — i.e. the new password actually works and the old
  one actually stops working. Asserting only that the hash changed would pass even if the hash were
  garbage.
- `createUser` now rejects a 7-character password (guards the alignment)

Tests must create their own throwaway user and delete it — this database holds **real staff records**
and must never be mutated by a test.

## 8. Out of scope

- Self-serve "Forgot password?" on the login page.
- Session revocation on reset (needs `passwordChangedAt` + a JWT callback check).
- An audit table.
- Email-based reset (approach B) — and if revisited, see the token-reuse trap in §2.
