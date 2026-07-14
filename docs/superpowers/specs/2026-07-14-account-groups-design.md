# Account Groups — Grouped Profitability View

**Date:** 2026-07-14
**Status:** Approved for implementation (user confirmed the two open decisions: group net = sales margin + delivery result; Super Admin + Admin manage groups)
**Depends on:** accounts/sales module, delivery module (PR #12)

## 1. Problem

One real-world university often exists as SEVERAL account rows (e.g. a "university"
account plus a "programme" account — both live under the same institution). Sales and
delivery numbers are tracked per account and must stay that way, but management needs to
answer one question per institution: **is this university, taken as a whole, profitable
for us?** Users will manually group the accounts that belong together; a new grouped
view shows cumulative numbers. Individual account views are untouched.

## 2. Approaches considered

**A. `account_groups` table + nullable `group_id` on accounts (CHOSEN).**
An account belongs to at most one group (a physical institution), so a nullable FK
column is the natural model — no join table, trivial queries (`GROUP BY group_id`),
deleting a group auto-ungroups members via `ON DELETE SET NULL`.
*Cons:* touches the accounts table (one additive nullable column — safe).

**B. Join table `account_group_members`.** More ceremony for the same single-membership
constraint (needs UNIQUE(account_id)); only pays off if an account could ever belong to
several groups — it can't. *Rejected.*

**C. Derive groups by name/city matching.** No manual step, but wrong groupings are
worse than none, and the user explicitly wants manual selection. *Rejected.*

## 3. Data model (migration `0011_account_groups.sql`)

**`account_groups`**: `id` serial PK, `name` text NOT NULL UNIQUE (e.g. the university's
name), `created_at` timestamp defaultNow.

**`accounts`** += `group_id` integer NULL, FK → `account_groups.id` **ON DELETE SET
NULL** (deleting a group simply ungroups its members; accounts and their money are
never touched).

No other schema changes. Both statements idempotent per house migration rules.

## 4. The numbers (semantics confirmed by user)

All sales figures reuse the existing money engine — a group is just a JS-side sum of
its member accounts' `computeAccount` outputs. Nothing new is persisted.

Per group, for the selected academic year:
- **Sales (year-scoped, from member invoices):** billed, received, outstanding,
  payable, **net margin** = Σ member `netMargin`.
- **Delivery (all-time, labelled as such — academic years have no date range):**
  allocated = Σ member programs' non-cancelled event budgets; spent = Σ activity costs;
  **delivery result = allocated − spent** (the user's "delivery profit"; negative = overrun).
- **Group net = sales net margin + delivery result** — the headline
  profitable-or-not figure, always displayed with its formula label
  ("sales margin + delivery result") and a green **Profitable** / red **Loss-making**
  badge on its sign. Both components stay visible beside it, so nothing is hidden.

## 5. Authorization

- `canManageGroups(user)` = super-admin ‖ admin (+ `assertGroupsManage`). Creating,
  renaming, re-membering, deleting.
- Visibility follows the accounts list: the grouped view lives in the Finance section
  (super-admin + admin). **All rollups are computed only over accounts in the caller's
  RBAC scope** (same `scopeAccountIds` rule as `listAccountsForUser`); a group with no
  visible members is hidden from that user. Admins can only group accounts they can see.
- viewer / hr / delivery roles: no groups UI, DAL asserts reject them.

## 6. Routes & UI

| Route | Purpose |
|---|---|
| `/accounts/groups` | **Grouped view**: table of groups — name, member count, billed, received, outstanding, sales margin, delivery allocated · spent, delivery result, **group net** with badge; "New group" dialog (name + checkbox multi-select of currently UNGROUPED in-scope accounts); ungrouped-accounts count shown so nothing gets lost |
| `/accounts/groups/[id]` | Group detail: header (name, rename inline, delete with confirm), KPI tiles (sales margin · delivery allocated · spent · **group net** with formula + badge), member accounts table (each row links to the unchanged individual account page; per-account billed/margin/delivery spent), member management (add ungrouped account via Combobox, remove per row) |

- `/accounts` list gets a "Grouped view →" link next to its header (and each grouped
  account row shows nothing new — individual view unchanged, per the requirement).
- Account detail page: small "Part of {group}" chip linking to the group (read-only).

## 7. DAL (`lib/dal/groups.ts`)

- `listGroups(user, yearLabel)` → `GroupRow[]` with the §4 rollups. Implementation:
  reuse `listAccountsForUser(user, yearLabel)` (gains a `groupId` field in its select —
  additive) and sum rows by group in JS; one extra grouped query joins
  programs→events→activities by `accounts.group_id` for the delivery numbers. No N+1.
- `getGroupDetail(user, id, yearLabel)` → group + per-member rows + rollups; null when
  out of scope/missing (page 404s).
- `listUngroupedAccounts(user)` → in-scope accounts with `group_id IS NULL` (pickers).
- Mutations (all `assertGroupsManage` + membership limited to in-scope accounts):
  `createGroup(user, name, accountIds)`, `renameGroup`, `addAccountsToGroup`,
  `removeAccountFromGroup`, `deleteGroup` (FK does the ungrouping).

## 8. Testing

- Integration: create group with 2 fixture accounts → listGroups sums billed/margin
  exactly; delivery rollup (event budgets + activity costs across two member accounts)
  matches; group net = margin + (allocated − spent); admin scoping (member outside
  scope excluded from that admin's rollup); role rejections (viewer/hr/delivery);
  remove member → sums shrink; delete group → accounts ungrouped, not deleted.
- Existing suites stay green (accounts list select gains one field; no behaviour change).

## 9. Out of scope (deliberate)

- Auto-grouping suggestions; multi-group membership; group-level budgets or targets;
  grouping in reports/OEM pages; year-scoped delivery filtering (needs date ranges on
  academic years first).
