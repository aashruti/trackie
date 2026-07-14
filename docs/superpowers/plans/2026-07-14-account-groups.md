# Account Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manually group accounts that belong to one university and add a grouped view showing cumulative sales + delivery numbers and a group-net profitable/loss verdict, leaving individual views untouched.

**Architecture:** `account_groups` table + nullable `accounts.group_id` (one group per account, `ON DELETE SET NULL`); a `lib/dal/groups.ts` that reuses `listAccountsForUser` for sales rollups (summed by `groupId` in JS) plus one grouped query for delivery allocated/spent; two new Finance routes (`/accounts/groups`, `/accounts/groups/[id]`) following the HR/delivery page conventions. Group net = sales margin + (delivery allocated − spent), always labelled with its formula.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres, NextAuth v5, Tailwind 4 tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-account-groups-design.md`

**House rules:** batch queries + group in JS (no N+1); `Promise.all` independents; numeric columns are strings; migrations via `drizzle/*.sql` + `_journal.json` + local apply with `VERCEL="" DATABASE_URL=<local>`; server actions return `ActionResult`; DAL takes `user: SessionUser` first and asserts.

---

### Task 1: Schema + migration 0011

**Files:** Modify `lib/db/schema.ts`; Create `drizzle/0011_account_groups.sql`; Modify `drizzle/meta/_journal.json` (idx 11).

- [ ] schema.ts — add before the accounts table:

```ts
// Manual grouping of accounts that belong to one university, for the grouped
// profitability view. Spec: docs/superpowers/specs/2026-07-14-account-groups-design.md
export const accountGroups = pgTable("account_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

  and on `accounts`: `groupId: integer("group_id").references(() => accountGroups.id, { onDelete: "set null" }),`

- [ ] Migration (idempotent, `--> statement-breakpoint` separated): CREATE TABLE IF NOT EXISTS account_groups (id serial PK, name text NOT NULL, created_at timestamp DEFAULT now() NOT NULL, CONSTRAINT account_groups_name_unique UNIQUE(name)); ALTER TABLE accounts ADD COLUMN IF NOT EXISTS group_id integer; DO $$ FK accounts.group_id → account_groups(id) ON DELETE set null.
- [ ] Journal entry idx 11, tag `0011_account_groups`.
- [ ] Apply locally: `export VERCEL="" DATABASE_URL=<from .env.local>; npx tsx scripts/db-migrate.ts`; verify with psql.
- [ ] Commit: `feat(groups): schema + migration 0011 (account_groups, accounts.group_id)`

### Task 2: Authz + accounts-list groupId

**Files:** Modify `lib/dal/authz.ts`, `lib/dal/authz.test.ts`, `lib/dal/accounts.ts`.

- [ ] authz.ts:

```ts
/** Group management (create/rename/membership/delete) — finance roles. */
export function canManageGroups(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "admin";
}
export function assertGroupsManage(user: SessionUser): void {
  if (!canManageGroups(user)) throw new UserError("Account groups are managed by Admin / Super Admin only");
}
```

- [ ] authz.test.ts: matrix — super-admin/admin true; viewer/hr/delivery false + assert throws.
- [ ] accounts.ts `listAccountsForUser`: add `groupId: accounts.groupId` to the accRows select and `groupId: a.groupId` to the result push (additive; no callers break).
- [ ] Run `npx vitest run lib/dal/authz.test.ts lib/dal/accounts.test.ts` → PASS. Commit: `feat(groups): authz helpers + groupId on account rows`

### Task 3: Groups DAL + tests

**Files:** Create `lib/dal/groups.ts`, `lib/dal/groups.test.ts`.

- [ ] Types & signatures (all take `user: SessionUser`; reads restricted to canManageGroups too — the grouped view is Finance-only per spec §5):

```ts
export type GroupSales = { billing: number; received: number; outstanding: number; payable: number; netMargin: number };
export type GroupDelivery = { programs: number; allocated: number; spent: number; result: number }; // result = allocated − spent
export type GroupRow = {
  id: number; name: string; memberCount: number; // in-scope members
  sales: GroupSales; delivery: GroupDelivery;
  groupNet: number; // sales.netMargin + delivery.result
};
export type GroupMember = { id: number; name: string; type: string; oem: string; billing: number; netMargin: number; deliverySpent: number; status: string };
export type GroupDetail = GroupRow & { members: GroupMember[] };

export async function listGroups(user, yearLabel): Promise<GroupRow[]>;        // groups with ≥1 in-scope member
export async function getGroupDetail(user, id, yearLabel): Promise<GroupDetail | null>;
export async function listUngroupedAccounts(user): Promise<{ id: number; name: string }[]>; // in-scope, group_id IS NULL
export async function createGroup(user, name, accountIds: number[]): Promise<{ id: number }>;
export async function renameGroup(user, id, name): Promise<void>;
export async function addAccountsToGroup(user, id, accountIds: number[]): Promise<void>;
export async function removeAccountFromGroup(user, accountId): Promise<void>;
export async function deleteGroup(user, id): Promise<void>; // FK set-null ungroups members
```

- [ ] Implementation contracts: sales rollups = `listAccountsForUser(user, yearLabel)` filtered to `groupId != null`, summed per group in JS (row now carries groupId). Delivery rollup = ONE query: `accounts(group_id NOT NULL) ⟕ programs ⟕ delivery_events(status <> 'cancelled' for budget)` sums via SQL grouped by group_id, plus ONE activities-cost query grouped by group_id; per-member deliverySpent from a per-account grouped variant reused by detail. Membership mutations: verify every accountId is in the caller's scope (`scopeAccountIds`; for admin use `assignedIds`) AND currently ungrouped (for add/create) → `UserError` otherwise; name trimmed/unique (23505 → UserError). deleteGroup/renameGroup 404 → UserError "Group not found."
- [ ] Tests (fixtures pattern from delivery: unique-suffix oem + 2 accounts + invoices? — sales sums need invoices: insert 2 accounts with one raised invoice each via direct db insert with known students/prices so netMargin is exact; plus a program+event+activity under each account): create group → listGroups sums billed/margin exactly; delivery allocated/spent/result exact; groupNet = margin + result; scoping: admin actor with assignedIds=[acc1] sees memberCount 1 and only acc1 sums (pass assignedOverride? — no: insert user_accounts row for a fixture admin user); removeAccountFromGroup shrinks sums; deleteGroup → accounts remain, group gone; viewer/hr/delivery rejected; create with out-of-scope account rejected; create with already-grouped account rejected.
- [ ] `npx vitest run lib/dal/groups.test.ts` → PASS. Commit: `feat(groups): groups DAL — rollups, membership, scoping`

### Task 4: Grouped-view pages

**Files:** Create `app/(app)/accounts/groups/{page.tsx,actions.ts,loading.tsx}`, `app/(app)/accounts/groups/[id]/{page.tsx,loading.tsx}`, `components/groups/groups-explorer.tsx`, `components/groups/new-group-dialog.tsx`, `components/groups/group-detail.tsx`. Modify `components/accounts/accounts-explorer.tsx` (or the accounts page header) for the "Grouped view →" link; `app/(app)/accounts/[id]/page.tsx` for the group chip.

- [ ] actions.ts (one file serves both routes): `createGroupAction(name, accountIds) → CreateResult{id}`, `renameGroupAction(id, name)`, `addAccountsAction(id, accountIds)`, `removeAccountAction(groupId, accountId)`, `deleteGroupAction(id)` — actor() helper, ActionResult, `console.error("[groups:*]")`, revalidate `/accounts/groups`, `/accounts/groups/${id}`, `/accounts`.
- [ ] `/accounts/groups` page: HR skeleton; `canManageGroups` inline denial; `Promise.all([listGroups(actor, YEAR), listUngroupedAccounts(actor)])`; renders GroupsExplorer (stat strip: groups / grouped accounts / ungrouped count; table per spec §6 — Money cells, delivery "allocated · spent", result + group net with tone; Profitable/Loss badge; row → detail; "New group" gated on canManage).
- [ ] NewGroupDialog: name input + checkbox list of ungrouped accounts (min 1), createGroupAction → router.push to new group.
- [ ] `/accounts/groups/[id]` page: awaited params; `getGroupDetail`; notFound() on null; header (name + rename inline via pencil→input, Delete with confirm → back to /accounts/groups), 4 KPI tiles (Sales margin {YEAR} / Delivery allocated (all time) / Delivery spent / **Group net** with sublabel "sales margin + delivery result" + badge), members table (link, billed, margin, delivery spent, status badge, Remove button when canManage), "Add account" Combobox of ungrouped accounts.
- [ ] Accounts page header: `Grouped view →` Link (visible to canManageGroups) next to existing actions. Account detail subtitle: when `detail.groupId` (add groupId+groupName to getAccountDetail select — additive) render chip `Part of {groupName}` → `/accounts/groups/{groupId}`.
- [ ] loading.tsx for both routes (TopbarSkeleton + table/tile skeletons).
- [ ] Commit: `feat(groups): grouped view — explorer, group detail, account links`

### Task 5: Verification & ship

- [ ] `npm test` (only pre-existing leadStats failure), `npx tsc --noEmit`, `npm run lint` (no new errors), `VERCEL="" npm run build`.
- [ ] Browser E2E as super-admin: group the two Medicaps accounts ("Medicaps University" + "Medicaps DG Programme") into "Medicaps"; verify list sums = sum of the two account rows; open detail; add/remove member; rename; verify /accounts unchanged; verify account detail chip; delete + recreate group.
- [ ] Multi-agent review (correctness/authz/queries/conventions, adversarial verify) + fix confirmed findings.
- [ ] Push branch, open PR (no customer names in the body), monitor checks.

## Self-review

**Spec coverage:** §3→T1; §5→T2+T3 (asserts + scope); §4 numbers→T3 (rollups+groupNet) & T4 (tiles/labels); §6 routes/links/chip→T4; §8 tests→T2/T3/T5. **Placeholders:** none — every step names files, signatures, exact behaviours. **Type consistency:** GroupRow/GroupDetail/GroupMember defined T3, consumed T4; canManageGroups defined T2, used T3/T4; groupId added in T2, consumed T3 + account-detail chip in T4.
