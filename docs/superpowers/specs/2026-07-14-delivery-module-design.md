# Delivery Module — Programs, Events, Activities, Board & Calendar

**Date:** 2026-07-14
**Status:** Approved for implementation (user delegated design decisions: "I leave it up to you")
**Depends on:** existing accounts/sales module, team board, HR module conventions

## 1. Problem

Sales (accounts/invoices) and HR are built. The delivery team — who execute the programs
sales has sold — has no home in trackie. Their needs:

1. **Delivery methods (teaching styles)** — a managed catalogue (Direct to Students,
   Teach the Teacher, …) that can be attached per program.
2. **Programs** — one account can run several programs at once, each with its own
   provider and method (e.g. Medica runs an IBM D2S program *and* a Datagami T3 program).
   Today an account has exactly one `oemId` and no program entity — this is the modelling gap.
3. **Events with budgets** — each program has events; each event has an allocated budget;
   delivery must stay within it.
4. **Activity log** — everything done under an event is logged, so that at renewal time
   sales can print a comprehensive annual report per account as proof of delivery.
5. **Delivery board** — a kanban the delivery team will actually use (sales barely uses
   the current one).
6. **Program calendar** — month view of all events + activities planned for a program.

## 2. Approaches considered

**A. First-class `programs` entity + `delivery_*` tables + board discriminator (CHOSEN).**
New `programs` table under `accounts` with its own `oem_id` and `delivery_method_id`,
`delivery_events` + `delivery_activities` beneath it, and a `board` column on the existing
`tasks` table so the proven kanban is reused on a second board. New `delivery` role.
*Pros:* models reality (N programs per account, provider per program), leaves finance
untouched, maximal reuse of board/calendar patterns. *Cons:* one migration touching the
`tasks` table and a `TeamBoard` refactor to make it route-agnostic.

**B. Programs as accounts of `type='programme'`.** No new entity; hang delivery data off
accounts and create child accounts per program. *Rejected:* pollutes finance rollups and
account lists, still can't express two providers under one university cleanly, and every
finance surface would need "is this a real account?" filters.

**C. Separate `delivery_tasks` table + new board component.** *Rejected:* duplicates the
kanban DAL/UI/comments for no benefit; the existing board only needs a discriminator
column and path-parameterisation.

## 3. Data model (migration `0010_delivery_module.sql`)

New enums (created with the `DO $$ … duplicate_object` pattern; role value via
`ALTER TYPE … ADD VALUE IF NOT EXISTS`):

- `role` += **`delivery`**
- `program_status`: `planned | active | completed | on-hold`
- `delivery_event_status`: `planned | completed | cancelled`
- `delivery_activity_type`: `session | meeting | logistics | procurement | milestone | expense | note`
- `task_board`: `team | delivery`

New tables (Drizzle conventions: serial PK `id`, snake_case columns, `numeric` money as
strings, `created_at defaultNow()`):

**`delivery_methods`** — the teaching-style catalogue, managed in Delivery settings.
`id`, `name` (NOT NULL, e.g. "Direct to Students"), `code` (NOT NULL UNIQUE, e.g. "D2S"),
`description`, `active` bool NOT NULL default true. Deactivate rather than delete once used
(FK from programs is `no action`, so deletes of in-use methods fail loudly).

**`programs`** — the sold program being delivered.
`id`, `account_id` NOT NULL FK→accounts **cascade** (account deletion sweeps its delivery
data without touching `deleteAccount`), `oem_id` NOT NULL FK→oems (provider of THIS
program — IBM vs Datagami; independent of the account's sales-side `oemId`),
`delivery_method_id` NOT NULL FK→delivery_methods (no action), `name` NOT NULL,
`description`, `status` program_status NOT NULL default `active`, `start_date` date,
`end_date` date, `total_budget` numeric (nullable — optional program-level envelope),
`created_at`.

**`delivery_events`** — budgeted events under a program.
`id`, `program_id` NOT NULL FK→programs cascade, `title` NOT NULL, `description`,
`venue`, `start_date` date NOT NULL, `end_date` date (null = single-day),
`budget` numeric NOT NULL default '0' (allocated), `status` delivery_event_status NOT NULL
default `planned`, `owner_user_id` FK→users set null, `created_at`.
**Spent is never stored** — it is Σ `delivery_activities.cost` for the event, computed at
read time (same philosophy as derived account status).

**`delivery_activities`** — the activity/expense log under an event.
`id`, `event_id` NOT NULL FK→delivery_events cascade, `type` delivery_activity_type NOT
NULL default `note`, `title` NOT NULL, `body` text, `activity_date` date NOT NULL,
`cost` numeric NOT NULL default '0' (0 = non-monetary activity; >0 makes the log double as
the expense ledger), `created_by_user_id` FK→users set null, `author` text NOT NULL
(display-name snapshot, mirroring `lead_activities`), `created_at`.

**`tasks`** — two additive columns:
`board` task_board NOT NULL default `'team'` (existing rows stay on the team board),
`program_id` FK→programs set null (delivery tasks can carry program context).

## 4. Authorization

- New role **`delivery`** ("Delivery team" label in `role-label.ts`).
- `lib/dal/authz.ts` gains:
  - `canAccessDelivery(user)` → super-admin ‖ delivery ‖ **admin** (sales/finance can READ —
    they need the renewal report), plus `assertDeliveryAccess`.
  - `canManageDelivery(user)` → super-admin ‖ delivery, plus `assertDeliveryManage`.
- Every `lib/dal/delivery/*` read asserts access; every write asserts manage. Defense in
  depth exactly like HR (page-level friendly denial + DAL assert + 403 in route handlers).
- `proxy.ts` unchanged: viewers stay locked to `/team`; delivery role roams like hr
  (finance data stays protected by account-scoping — delivery users have no `user_accounts`
  rows, and delivery DAL access is module-gated, not account-assignment-gated).
- Sidebar: new **Delivery** group (Programs, Delivery board, Delivery settings) shown to
  super-admin ‖ delivery; delivery-only users get a Dashboard item prepended (HR pattern).
- Dashboard: `role === "delivery"` branches to a `DeliveryDashboardView` (HR pattern).

## 5. Routes & pages (all follow the HR page skeleton)

| Route | Purpose |
|---|---|
| `/delivery/programs` | Program list: account, method chip, provider, dates, status, events count, budget vs spent; filters; "New program" (manage-gated) |
| `/delivery/programs/[id]` | Program detail: header + KPI cards (events, allocated, spent, over-budget count); **Events tab** (event cards with budget bar, inline activity log + add-activity form, edit/status/delete); **Calendar tab** (month grid) |
| `/delivery/board` | Delivery kanban (`board='delivery'`), all six columns incl. backlog (no separate backlog page), program picker on new tasks |
| `/delivery/settings` | Teaching-styles manager (add/edit/deactivate `delivery_methods`) |
| `/delivery/report/[accountId]` | **Printable renewal/annual report**: per program → method, provider, period, events (dates, venue, budget vs spent, status) → activities (date, type, title, cost, author); totals footer. Readable by admin (sales) too; linked from the account detail header |

Calendar: 7-column month grid (reusing the HR calendar idiom + `MonthSwitcher` with the
"no future months" guard lifted — delivery plans ahead). Cells show event chips (an event
spans every day in `[start_date, end_date]`) and activity dots; `?month=YYYY-MM` URL state.

## 6. Team-board reuse

`TeamBoard` becomes route-agnostic: new props `basePath` (`"/team"` | `"/delivery/board"`)
and `board`; the hard-coded `router.push("/team?done=…")` and backlog links derive from
`basePath`. Board actions accept/carry the board key and revalidate `/team`,
`/team/backlog`, and `/delivery/board`. `listTasks`/`listTasksWithComments`/`createTask`
gain a `board` filter (default `'team'` — existing behaviour unchanged).
`listTaskOptions` additionally returns programs (id, name, accountId) for the delivery
dialog: picking a program auto-fills the account. Task cards show a program chip when set.
`/team` keeps its current columns + backlog page; `/delivery/board` renders all six
columns (backlog included) — delivery triage happens on one screen.

## 7. DAL layout (`lib/dal/delivery/`)

- `methods.ts` — `listMethods` (opt. include inactive), `createMethod`, `updateMethod`,
  `setMethodActive`.
- `programs.ts` — `listPrograms(user, {accountId?, status?})` (joins accounts/oems/methods;
  batched event+spent rollups — no N+1), `getProgramDetail(user, id)` (program, events,
  activities grouped by event, budget rollups), `createProgram`, `updateProgram`,
  `deleteProgram` (manage-gated; cascade cleans children), `listAccountOptions(user)`
  (id/name for pickers), `getProgramCalendar(user, id, year, month)` → `{days, cells}`.
- `events.ts` — `createEvent`, `updateEvent`, `setEventStatus`, `deleteEvent`,
  `addActivity`, `deleteActivity`.
- `report.ts` — `getAccountDeliveryReport(user, accountId)` → account header, per-program
  blocks with events + activities + totals (allocated, spent, counts).

Pure helpers exported for unit tests: budget rollup, calendar-cell builder.

## 8. Seed & ops

- `scripts/seed-delivery.ts` (+ `npm run db:seed-delivery`): upserts methods
  **D2S — Direct to Students** and **T3 — Teach the Teacher**.
- Migration applies via `npx tsx scripts/db-migrate.ts` locally and `vercel-build` on deploy.
- Assigning the `delivery` role to real users (e.g. current viewer-role staff) is a
  data/admin action done in `/admin/users` — not part of this change.

## 9. Testing

- Integration (`lib/dal/delivery/*.test.ts`, seeded local DB, vitest): program CRUD +
  rollup math; event budget vs spent (incl. over-budget); activity add/delete recomputes
  spent; report shape; role rejections (viewer everywhere, admin rejected from writes,
  delivery accepted); board filter isolation (`team` tasks invisible on `delivery` board).
- Unit: calendar cell builder (spanning events, month boundaries), budget rollups.
- Existing `lib/board/constants.test.ts` and task tests must stay green (board param
  defaults preserve behaviour).

## 10. Out of scope (deliberate)

- File attachments on activities (blob infra exists; add later if asked).
- Event-type taxonomy (title + activity types suffice; YAGNI).
- Notifications/emails for delivery events.
- Changing viewer-role behaviour or migrating existing users to the delivery role.
