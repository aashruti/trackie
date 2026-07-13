# Delivery Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the delivery-team module — programs (with delivery methods/teaching styles) under accounts, budgeted events, activity logging, a delivery kanban board, per-program month calendar, and a printable per-account renewal report.

**Architecture:** New `delivery` role + `delivery_methods` / `programs` / `delivery_events` / `delivery_activities` tables (migration 0010); `tasks` gains `board` + `program_id` so the existing kanban serves a second, delivery-scoped board; module follows the HR-module conventions exactly (page skeleton, actions.ts + ActionResult, server-only DAL with assert helpers, client "manager" components, month-grid calendar).

**Tech Stack:** Next.js 16.2.9 App Router (params/searchParams are Promises; proxy.ts not middleware), Drizzle + Neon Postgres, NextAuth v5, Tailwind 4 design tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-delivery-module-design.md`

**House rules that bind every task:** no N+1 (batch by id arrays, group in JS Maps); `Promise.all` independent queries; `getYearContext()` once per page; numeric columns are strings (String() on write, Number() on read); migrations via `drizzle/*.sql` + `_journal.json` + `npx tsx scripts/db-migrate.ts`, enum creation via `DO $$ … duplicate_object`, never `CREATE TYPE IF NOT EXISTS`; server actions return `ActionResult`, never throw user-facing errors; DAL files start `import "server-only"` and take `user: SessionUser` first.

---

### Task 0: Branch + separate the pending HR-settings working-tree files

**Files:** none created — git only.

- [ ] `git checkout -b feat/delivery-module`
- [ ] Commit the user's completed-but-uncommitted HR-settings feature as its own labeled commit so delivery commits stay clean:
      `git add app/\(app\)/hr/settings components/hr/hr-settings-manager.tsx lib/dal/hr/holidays.ts components/shell/sidebar.tsx && git commit -m "feat(hr): settings page — holiday management (from working tree)"`
      Leave uncommitted: `scripts/fix-due-date.ts` (imports uninstalled pkg — breaks build; keep out), `scripts/reset-db.ts` mod, `vercel.json`, `app/api/ping/` (deployment experiments, not this feature).

### Task 1: Enums, schema, migration 0010

**Files:**
- Modify: `lib/db/enums.ts` (append delivery enums + types)
- Modify: `lib/db/schema.ts` (pgEnums + 4 tables + 2 task columns)
- Create: `drizzle/0010_delivery_module.sql`
- Modify: `drizzle/meta/_journal.json` (idx 10)

- [ ] **enums.ts additions:**

```ts
// ── Delivery module ──
export const PROGRAM_STATUSES = ["planned", "active", "completed", "on-hold"] as const;
export const DELIVERY_EVENT_STATUSES = ["planned", "completed", "cancelled"] as const;
export const DELIVERY_ACTIVITY_TYPES = ["session", "meeting", "logistics", "procurement", "milestone", "expense", "note"] as const;
export const TASK_BOARDS = ["team", "delivery"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
export type DeliveryEventStatus = (typeof DELIVERY_EVENT_STATUSES)[number];
export type DeliveryActivityType = (typeof DELIVERY_ACTIVITY_TYPES)[number];
export type TaskBoard = (typeof TASK_BOARDS)[number];
```
Also add `"delivery"` to `ROLES`.

- [ ] **schema.ts:** `programStatusEnum = pgEnum("program_status", PROGRAM_STATUSES)`, `deliveryEventStatusEnum`, `deliveryActivityTypeEnum`, `taskBoardEnum = pgEnum("task_board", TASK_BOARDS)`. Tables per spec §3 (deliveryMethods, programs, deliveryEvents, deliveryActivities) with a header comment citing the spec; `tasks` gains `board: taskBoardEnum("board").notNull().default("team")` and `programId: integer("program_id").references(() => programs.id, { onDelete: "set null" })`.

- [ ] **Migration** `drizzle/0010_delivery_module.sql` (each statement separated by `--> statement-breakpoint`):

```sql
-- Delivery module: delivery role, methods catalogue, programs, events, activities,
-- board discriminator on tasks. Spec: docs/superpowers/specs/2026-07-14-delivery-module-design.md
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'delivery';--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."program_status" AS ENUM('planned','active','completed','on-hold'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."delivery_event_status" AS ENUM('planned','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."delivery_activity_type" AS ENUM('session','meeting','logistics','procurement','milestone','expense','note'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."task_board" AS ENUM('team','delivery'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_methods" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL UNIQUE,
  "description" text,
  "active" boolean NOT NULL DEFAULT true
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
  "id" serial PRIMARY KEY NOT NULL,
  "account_id" integer NOT NULL,
  "oem_id" integer NOT NULL,
  "delivery_method_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" "program_status" NOT NULL DEFAULT 'active',
  "start_date" date,
  "end_date" date,
  "total_budget" numeric,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "program_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "venue" text,
  "start_date" date NOT NULL,
  "end_date" date,
  "budget" numeric NOT NULL DEFAULT '0',
  "status" "delivery_event_status" NOT NULL DEFAULT 'planned',
  "owner_user_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_activities" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL,
  "type" "delivery_activity_type" NOT NULL DEFAULT 'note',
  "title" text NOT NULL,
  "body" text,
  "activity_date" date NOT NULL,
  "cost" numeric NOT NULL DEFAULT '0',
  "created_by_user_id" integer,
  "author" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "board" "task_board" NOT NULL DEFAULT 'team';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "program_id" integer;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "programs" ADD CONSTRAINT "programs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "programs" ADD CONSTRAINT "programs_oem_id_oems_id_fk" FOREIGN KEY ("oem_id") REFERENCES "public"."oems"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "programs" ADD CONSTRAINT "programs_delivery_method_id_delivery_methods_id_fk" FOREIGN KEY ("delivery_method_id") REFERENCES "public"."delivery_methods"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "delivery_activities" ADD CONSTRAINT "delivery_activities_event_id_delivery_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."delivery_events"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "delivery_activities" ADD CONSTRAINT "delivery_activities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tasks" ADD CONSTRAINT "tasks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] Append `{"idx":10,"version":"7","when":<epoch-ms>,"tag":"0010_delivery_module","breakpoints":true}` to `_journal.json`.
- [ ] Run `npx tsx scripts/db-migrate.ts` **with local env** (gotcha: the script prefers `.env.production.local` — verify it targets local; if the env layout makes it target prod, apply via a temporary explicit `DATABASE_URL` from `.env.local` instead) and verify tables exist (`psql`/drizzle query).
- [ ] Commit: `feat(delivery): schema + migration 0010 (role, methods, programs, events, activities, task board)`

### Task 2: Authz + role label

**Files:**
- Modify: `lib/dal/authz.ts`, `lib/auth/role-label.ts`
- Test: `lib/dal/authz.test.ts` (extend)

- [ ] Add to `authz.ts`:

```ts
export function canAccessDelivery(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "delivery" || user.role === "admin";
}
export function assertDeliveryAccess(user: SessionUser): void {
  if (!canAccessDelivery(user)) throw new UserError("Delivery is available to Delivery team / Admin / Super Admin only");
}
export function canManageDelivery(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "delivery";
}
export function assertDeliveryManage(user: SessionUser): void {
  if (!canManageDelivery(user)) throw new UserError("Only the Delivery team / Super Admin can modify delivery data");
}
```

- [ ] `role-label.ts`: `delivery` → "Delivery team" (long) / "Delivery" (short).
- [ ] Extend `authz.test.ts` (table-driven role matrix: viewer rejected everywhere; admin read-yes/write-no; delivery yes/yes; hr no). Run `npx vitest run lib/dal/authz.test.ts` → PASS.
- [ ] Commit: `feat(delivery): delivery role authz helpers`

### Task 3: Methods DAL + seed

**Files:**
- Create: `lib/dal/delivery/methods.ts`, `scripts/seed-delivery.ts`
- Modify: `package.json` (script `db:seed-delivery`)
- Test: `lib/dal/delivery/methods.test.ts`

- [ ] `methods.ts` (server-only): `export type DeliveryMethodRow = { id: number; name: string; code: string; description: string | null; active: boolean; programCount: number }`. Functions: `listMethods(user, { includeInactive = true } = {})` (assertDeliveryAccess; LEFT JOIN count of programs per method in one query); `createMethod(user, { name, code, description? })` (assertDeliveryManage; trim, non-empty, code uppercased, UserError on duplicate code via unique-violation catch); `updateMethod(user, id, { name, code, description })`; `setMethodActive(user, id, active)`. No hard delete (spec: deactivate; FK is `no action` so DB would refuse anyway).
- [ ] `seed-delivery.ts`: dotenv → dynamic import of db (ESM gotcha), upsert `("Direct to Students","D2S")` and `("Teach the Teacher","T3")` via `onConflictDoNothing` on code. Add `"db:seed-delivery": "tsx scripts/seed-delivery.ts"`.
- [ ] Integration test: super-admin creates method (unique suffix), lists it, deactivates, viewer/hr rejected, admin write rejected; afterAll deletes created rows. Run → PASS.
- [ ] Run seed against local DB.
- [ ] Commit: `feat(delivery): delivery methods DAL + seed (D2S, T3)`

### Task 4: Programs DAL (list / detail / CRUD / calendar)

**Files:**
- Create: `lib/dal/delivery/programs.ts`
- Test: `lib/dal/delivery/programs.test.ts`

- [ ] Types & signatures (all take `user: SessionUser` first; reads assert access, writes assert manage):

```ts
export type ProgramListRow = {
  id: number; name: string; status: ProgramStatus;
  accountId: number; accountName: string; oemName: string; selfSupplied: boolean;
  methodName: string; methodCode: string;
  startDate: string | null; endDate: string | null; totalBudget: number | null;
  eventCount: number; allocated: number; spent: number; // allocated = Σ event.budget, spent = Σ activities.cost
};
export function listPrograms(user, filters?: { accountId?: number; status?: ProgramStatus }): Promise<ProgramListRow[]>;

export type ProgramEvent = { id: number; title: string; description: string | null; venue: string | null;
  startDate: string; endDate: string | null; budget: number; spent: number; status: DeliveryEventStatus;
  ownerUserId: number | null; ownerName: string | null; activities: ProgramActivity[] };
export type ProgramActivity = { id: number; eventId: number; type: DeliveryActivityType; title: string;
  body: string | null; activityDate: string; cost: number; author: string; createdAt: string };
export type ProgramDetail = { /* ProgramListRow fields */ description: string | null; events: ProgramEvent[] };
export function getProgramDetail(user, id): Promise<ProgramDetail | null>; // null out-of-existence → page notFound()

export type NewProgram = { accountId: number; oemId: number; deliveryMethodId: number; name: string;
  description?: string; status?: ProgramStatus; startDate?: string; endDate?: string; totalBudget?: number };
export function createProgram(user, input: NewProgram): Promise<{ id: number }>;
export function updateProgram(user, id, edit: Partial<NewProgram>): Promise<void>;
export function deleteProgram(user, id): Promise<void>; // cascade removes events/activities; tasks.program_id nulls

export function listAccountOptions(user): Promise<{ id: number; name: string }[]>; // for pickers
export function listOemOptions(user): Promise<{ id: number; name: string; isSelf: boolean }[]>;

export type CalendarCell = { events: { id: number; title: string; status: DeliveryEventStatus; starts: boolean; ends: boolean }[];
  activities: { id: number; type: DeliveryActivityType; title: string; cost: number }[] };
export function getProgramCalendar(user, programId, year, month): Promise<{
  program: { id: number; name: string; accountName: string }; days: string[]; cells: Record<string, CalendarCell> } | null>;
```

- [ ] Batching contract: `listPrograms` = 1 programs query (joins accounts/oems/delivery_methods) + 1 grouped events query (`inArray(programId)`, SUM(budget), COUNT) + 1 grouped activities-cost query (join events for program_id, SUM(cost)) — never per-program queries. `getProgramDetail` = program row + events (`Promise.all` with activities via `inArray(eventId)`), group activities per event in a Map. Calendar: events overlapping the month (`start_date <= monthEnd AND coalesce(end_date, start_date) >= monthStart`) + activities in month via join; **pure helper** `buildCalendarCells(days, events, activities)` exported for unit tests (span expansion, starts/ends flags).
- [ ] Validation: name non-empty; dates ISO regex; endDate ≥ startDate (UserError); totalBudget ≥ 0; account/oem/method existence checked via the insert's FK errors surfaced as UserError.
- [ ] Tests: fixture account+oem inserted directly in beforeAll (unique names) → create program, list shows joined names + zero rollups; calendar helper unit cases (single-day, spanning, month-edge); role matrix; afterAll cleanup. Run → PASS.
- [ ] Commit: `feat(delivery): programs DAL (list/detail/CRUD/calendar)`

### Task 5: Events + activities DAL

**Files:**
- Create: `lib/dal/delivery/events.ts`
- Test: `lib/dal/delivery/events.test.ts`

- [ ] Signatures:

```ts
export type NewEvent = { programId: number; title: string; description?: string; venue?: string;
  startDate: string; endDate?: string; budget?: number; ownerUserId?: number };
export function createEvent(user, input: NewEvent): Promise<{ id: number }>;
export function updateEvent(user, id, edit: Omit<Partial<NewEvent>, "programId">): Promise<void>;
export function setEventStatus(user, id, status: DeliveryEventStatus): Promise<void>;
export function deleteEvent(user, id): Promise<void>;
export type NewActivity = { eventId: number; type: DeliveryActivityType; title: string; body?: string;
  activityDate: string; cost?: number };
export function addActivity(user, input: NewActivity): Promise<{ id: number }>; // author = session user's name (arg), createdBy = user.id
export function deleteActivity(user, id): Promise<void>;
```

  `addActivity` takes `authorName: string` as an extra arg from the action (session name), stores `author` + `created_by_user_id`. Budget ≥ 0, cost ≥ 0, dates validated, title non-empty; UserError otherwise.
- [ ] Tests: event under fixture program; add 2 activities (cost 6000 + 0) → `getProgramDetail` spent = 6000 & over-budget derivable; delete activity → spent recomputes; role matrix; cleanup. Run → PASS.
- [ ] Commit: `feat(delivery): events + activities DAL`

### Task 6: Report DAL

**Files:**
- Create: `lib/dal/delivery/report.ts`
- Test: `lib/dal/delivery/report.test.ts`

- [ ] `getAccountDeliveryReport(user, accountId): Promise<AccountDeliveryReport | null>` where:

```ts
export type AccountDeliveryReport = {
  account: { id: number; name: string; city: string | null; oemName: string };
  generatedOn: string; // ISO date
  totals: { programs: number; events: number; activities: number; allocated: number; spent: number };
  programs: Array<{ id: number; name: string; methodName: string; methodCode: string; oemName: string;
    status: ProgramStatus; startDate: string | null; endDate: string | null;
    allocated: number; spent: number;
    events: Array<ProgramEvent /* with nested activities, chronological */> }>;
};
```

  3–4 batched queries total (account, programs, events by programIds, activities by eventIds), grouped in JS; events + activities sorted chronologically for the printed narrative. Assert **access** (admin readable).
- [ ] Test: report over the Task-4/5 fixtures — counts and money totals exact; null for missing account. Run → PASS.
- [ ] Commit: `feat(delivery): account delivery report DAL`

### Task 7: Tasks DAL board-awareness

**Files:**
- Modify: `lib/dal/tasks.ts`, `lib/board/constants.ts`
- Test: `lib/dal/tasks.test.ts` (new) or extend constants test

- [ ] `TASK_SELECT` gains `board: tasks.board`, `programId: tasks.programId`, `programName: programs.name` (add `leftJoin(programs, eq(tasks.programId, programs.id))` to the two list queries). `TaskRow` in `lib/board/constants.ts` gains `board: TaskBoard; programId: number | null; programName: string | null`.
- [ ] `listTasks` / `listTasksWithComments` opts gain `board?: TaskBoard` (default `"team"`) → `eq(tasks.board, board)` in the where. `countTasksByStatus(status, board = "team")`. `myTasksToday` counts BOTH boards (dashboard shows all my due tasks) — leave unfiltered.
- [ ] `NewTaskInput` gains `board?: TaskBoard; programId?: number | null`. In `createTask`: if `programId` set, load the program; UserError if missing; derive `accountId` from it when not provided; UserError if a provided accountId mismatches. **`assertAssignable` runs only for `board === "team"`** (the user_accounts membership rule is a sales-side constraint; delivery staff have no account assignments).
- [ ] `listTaskOptions` returns `{ accounts, users, programs }` where programs = `{ id, name, accountId }[]` (active-status programs first, one query).
- [ ] Tests: create delivery-board task with programId only → accountId derived; team list excludes it; delivery list includes it; assignability skip verified (assignee w/o user_accounts row succeeds on delivery, fails on team). Run → PASS. Also `npx vitest run lib/board/constants.test.ts` stays green.
- [ ] Commit: `feat(delivery): board discriminator + program linkage on tasks`

### Task 8: TeamBoard route-agnostic refactor

**Files:**
- Modify: `components/team/team-board.tsx`, `components/team/new-task-dialog.tsx`, `components/team/task-detail-dialog.tsx` (program row display), `app/(app)/team/actions.ts`, `app/(app)/team/page.tsx`, `app/(app)/team/backlog/page.tsx`

- [ ] `TeamBoard` new props: `basePath?: string` (default `"/team"`), `board?: TaskBoard` (default `"team"`), `columns?: typeof BOARD_COLUMNS` (default BOARD_COLUMNS), `programs?: Option[]` (default `[]`), `showBacklogLink?: boolean` (default true). Replace every hard-coded `"/team"` in router.push/Links with `basePath`; done-window pushes `${basePath}?done=…`.
- [ ] `app/(app)/team/actions.ts`: `revalidateBoard()` helper revalidates `/team`, `/team/backlog`, `/delivery/board`; `addTaskAction` passes through `board`/`programId`. (Both boards keep importing these same actions — only revalidation broadens.)
- [ ] `NewTaskDialog` props gain `programs: Option & { accountId: number }[]` and `board: TaskBoard`; when `board === "delivery"` show a Program combobox above Account; selecting a program sets/locks account to the program's account. Card + detail dialog render a program chip when `programName` present.
- [ ] `/team` + `/team/backlog` pages: pass `board="team"`, `basePath="/team"` explicitly; behaviour identical (verify board loads, drag, create).
- [ ] Commit: `refactor(team): route-agnostic board (basePath/board props, program chip)`

### Task 9: /delivery/board page

**Files:**
- Create: `app/(app)/delivery/board/page.tsx`, `app/(app)/delivery/board/loading.tsx`

- [ ] Page: HR skeleton (auth → getYearContext → actor → `canAccessDelivery` inline denial) → `Promise.all([listTasksWithComments({ statuses: TASK_STATUSES, board: "delivery", doneWithinDays }), listTaskOptions()])` → `<TeamBoard variant="board" board="delivery" basePath="/delivery/board" columns={TASK_COLUMNS} programs={options.programs} showBacklogLink={false} …/>` (all six columns incl. backlog — no separate backlog page). Reads `searchParams` `{done?, assignee?, due?}` like /team.
- [ ] loading.tsx mirroring the team board skeleton.
- [ ] Commit: `feat(delivery): delivery board page`

### Task 10: /delivery/settings (teaching styles)

**Files:**
- Create: `app/(app)/delivery/settings/page.tsx`, `app/(app)/delivery/settings/actions.ts`, `components/delivery/delivery-settings-manager.tsx`

- [ ] Actions (`"use server"`, actor() helper, ActionResult, `console.error("[delivery:*]")`, revalidate `/delivery/settings` + `/delivery/programs`): `createMethodAction`, `updateMethodAction`, `setMethodActiveAction`.
- [ ] Page: manage-gated UI (page checks `canAccessDelivery` for view; manager receives `canManage` bool) → `listMethods(actor)` → `<DeliverySettingsManager methods canManage/>`.
- [ ] Manager (mirrors `hr-settings-manager.tsx`): add form (name, code, description), list with program-count column, per-row edit (inline) + Activate/Deactivate toggle with confirm(); `useTransition` + `run()` + `router.refresh()`; token styling.
- [ ] Commit: `feat(delivery): settings page — teaching styles manager`

### Task 11: /delivery/programs list + create

**Files:**
- Create: `app/(app)/delivery/programs/page.tsx`, `app/(app)/delivery/programs/actions.ts`, `app/(app)/delivery/programs/loading.tsx`, `components/delivery/programs-explorer.tsx`, `components/delivery/new-program-dialog.tsx`

- [ ] Actions: `createProgramAction(input: NewProgram)` (revalidate `/delivery/programs`; return `{ok:true, id}` so the dialog can `router.push` to the new program), `deleteProgramAction(id)` (revalidate list).
- [ ] Page: access-gated → `Promise.all([listPrograms(actor), listMethods(actor, {includeInactive:false}), listAccountOptions(actor), listOemOptions(actor)])` → explorer.
- [ ] Explorer (client): stat strip (programs, active, total allocated, total spent); filter row (search, account, method, status); table — Program / Account / Method chip / Provider / Period / Events / Budget (allocated vs spent, red when spent>allocated) / Status badge; row click → `/delivery/programs/{id}`; "New program" (canManage) opens `NewProgramDialog` (Combobox account, selects for method/OEM — OEM defaults to account's provider is NOT assumed; user picks; date inputs; optional total budget). Swallow `NEXT_REDIRECT` if navigating from the dialog.
- [ ] Commit: `feat(delivery): programs list + create`

### Task 12: /delivery/programs/[id] detail (events, activity log, calendar)

**Files:**
- Create: `app/(app)/delivery/programs/[id]/page.tsx`, `app/(app)/delivery/programs/[id]/actions.ts`, `app/(app)/delivery/programs/[id]/loading.tsx`, `components/delivery/program-detail.tsx`, `components/delivery/program-calendar.tsx`
- Modify: `components/hr/month-switcher.tsx` (add `allowFuture?: boolean` prop, default false — HR behaviour unchanged)

- [ ] Page: `params: Promise<{id}>` await + Number; `searchParams: Promise<{month?, tab?}>` month regex `^\d{4}-(0[1-9]|1[0-2])$` default current; `Promise.all([getProgramDetail, getProgramCalendar])`; `notFound()` on null; render header (name, account link-back, method chip, provider, status badge, period) + KPI cards (Events, Allocated, Spent, Remaining/Over — red when negative) + `<ProgramDetail/>` with tabs **Events | Calendar**.
- [ ] Actions: `createEventAction`, `updateEventAction`, `setEventStatusAction`, `deleteEventAction`, `addActivityAction` (author = session user name), `deleteActivityAction`, `updateProgramAction` — all revalidate `/delivery/programs/[id]` + `/delivery/programs` (+ `/delivery/report` readers are dynamic; report page fetches live).
- [ ] Events tab: "Add event" inline expandable form (title, venue, dates, budget, owner Combobox of users? — owner optional select of users from `listTaskOptions().users` passed by page); event cards: title, status pill picker (planned/completed/cancelled), dates, venue, budget bar (`spent/budget`, percentage, `over budget by ₹X` red note), edit (inline swap like InvoiceEditor pattern), delete with confirm; expandable **activity log**: chronological list (date, type chip, title, body, cost as `<Money/>`, author avatar) + add-activity composer (type select, title, body, date default today, cost default 0); delete per activity (manage-gated).
- [ ] Calendar tab: `<ProgramCalendar days cells monthLabel/>` — 7-col grid (HR calendar idiom: Sun–Sat header, firstDow pads, aspect-square cells), event chips colored by status (spanning days render the chip with rounded-left only on `starts`, rounded-right only on `ends`), activity dots with tooltip (title · type · cost); `MonthSwitcher allowFuture` (URL `?month=` round-trip preserving `tab=calendar`).
- [ ] Commit: `feat(delivery): program detail — events, activity log, calendar`

### Task 13: Printable account report + account-page link

**Files:**
- Create: `app/(app)/delivery/report/[accountId]/page.tsx`, `app/(app)/delivery/report/[accountId]/loading.tsx`
- Modify: `app/(app)/accounts/[id]/page.tsx` (header link)

- [ ] Report page (server, no client component needed except PrintButton reuse): access-gated (admin readable); `getAccountDeliveryReport`; `notFound()` when null. Print-clean layout (`print-card` pattern + `no-print` on chrome): report header ("Delivery report — {account} · generated {date}"), totals strip, then per program: heading (name · method · provider · period · status), events table (Date(s) | Event | Venue | Budget | Spent | Status), each event followed by its activity list (date, type, title, cost, author). Footer totals (allocated vs spent). `<PrintButton/>` reused from accounts.
- [ ] Account detail header: next to `AccountReportButton`, add `Delivery report` Link (`/delivery/report/{id}`) when `canAccessDelivery(actor)`.
- [ ] Commit: `feat(delivery): printable account delivery report`

### Task 14: Dashboard branch + sidebar

**Files:**
- Create: `components/delivery/delivery-dashboard.tsx`, `lib/dal/delivery/dashboard.ts`
- Modify: `app/(app)/dashboard/page.tsx`, `components/shell/sidebar.tsx`

- [ ] `dashboard.ts`: `getDeliveryDashboard(user)` → `{ programs: { total, active }, upcoming: Array<{eventId, title, programId, programName, accountName, startDate, endDate}> (next 14 days, ≤8), overBudget: Array<{eventId, title, programName, budget, spent}> (≤5), recent: Array<{title, type, programName, activityDate, author}> (last 10) }` — `Promise.all` of 4 grouped queries.
- [ ] `dashboard/page.tsx`: `if (user.role === "delivery") return <DeliveryDashboardView …/>` (colocated async server subcomponent, HR pattern) rendering `components/delivery/delivery-dashboard.tsx` (StatCards linking to /delivery/programs & /delivery/board; upcoming-events list linking to program calendars; over-budget alert card; recent-activity feed).
- [ ] Sidebar: `const DELIVERY: Item[] = [Programs /delivery/programs, Delivery board /delivery/board, Delivery settings /delivery/settings]`; `showDelivery = role === "super-admin" || role === "delivery"`; delivery-only users get Dashboard prepended (mirror HR block).
- [ ] Commit: `feat(delivery): delivery dashboard + sidebar group`

### Task 15: Verification & hardening pass

- [ ] `npm test` — full suite green (HR/finance suites unaffected).
- [ ] `npx tsc --noEmit` (move `scripts/fix-due-date.ts` aside first — known breaker, untracked) and `npm run lint`.
- [ ] `npm run build` passes.
- [ ] Live verify with the dev server + browser: seed methods; as super-admin create "Medica" scenario (IBM D2S program + Datagami T3 program), add event with budget, log activities incl. an expense pushing one event over budget; check list rollups, calendar spans, board task with program chip, printable report; verify /team board unchanged; verify role gating by checking an hr-role user sees denial text.
- [ ] Multi-agent code review (correctness / authz / N+1 / UI-conventions) + fix findings.
- [ ] Push branch + open PR (repo's established flow), body summarising module + migration note.

---

## Self-review (done at plan time)

- **Spec coverage:** methods catalogue→T3+T10; programs multi-per-account with provider→T1+T4+T11/12; event budgets + within-budget signal→T1+T5+T12 (budget bar/over-flag) + T11 rollups; activity log→T5+T12; annual/renewal report→T6+T13; board reuse→T7–T9; per-program calendar→T4+T12; delivery role/authz→T1+T2; dashboard+nav→T14; seeds/tests/ops→T3, per-task tests, T15.
- **Placeholder scan:** clean — every task names files, signatures, and behaviour; code given where structure is non-obvious (migration, authz, types).
- **Type consistency:** `ProgramEvent`/`ProgramActivity` defined in T4 and reused by T6 report; `TaskBoard` from T1 used in T7/8/9; `NewProgram` T4 ↔ actions T11; `listTaskOptions().programs` shape matches NewTaskDialog prop in T8.
