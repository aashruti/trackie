@AGENTS.md

# DB Migrations

- Every schema change goes through a Drizzle migration file in `drizzle/`. Never mutate the DB with ad-hoc scripts.
- Create the `.sql` file, add its entry to `drizzle/meta/_journal.json`, then run `npx tsx scripts/db-migrate.ts` locally and let `vercel-build` run it on deploy.
- Never use `CREATE TYPE IF NOT EXISTS` — PostgreSQL does not support it. Use the `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN null; END $$` pattern for idempotent enum creation.
- The `drizzle.__drizzle_migrations` table is the source of truth for what has been applied. Do not pre-seed or bypass it.

# DAL Query Rules

## No N+1 loops
Never issue DB queries inside a loop over rows. The pattern to follow:

```ts
// WRONG — 3 queries per account = 64 queries for 21 accounts
for (const a of accRows) {
  const invRows = await db.select()...where(eq(invoices.accountId, a.id));
  const lites   = await loadPaymentLites(invIds);
  const cohorts  = await loadCohortPricing(invIds);
}

// RIGHT — 4 queries total, regardless of account count
const allInvRows = await db.select()...where(inArray(invoices.accountId, accountIds));
const invsByAccount = new Map(...); // group in JS
const [lites, cohorts] = await Promise.all([loadPaymentLites(allInvIds), loadCohortPricing(allInvIds)]);
for (const a of accRows) { /* pure JS — no DB calls */ }
```

## Parallelise independent queries
Any two DB calls that do not depend on each other's result must use `Promise.all`:

```ts
// WRONG — sequential
const accRows  = await db.select()...from(accounts);
const userRows = await db.select()...from(users);

// RIGHT
const [accRows, userRows] = await Promise.all([
  db.select()...from(accounts),
  db.select()...from(users),
]);
```

## Year context — one call per page
`getCurrentYear()` calls `listYears()` internally. Pages must not also call `listYears()` separately. Use `getYearContext()` from `lib/dal/years.ts` which returns `{ currentYear, years }` in a single DB round-trip:

```ts
// WRONG — 2× listYears per page load
const YEAR  = await getCurrentYear();
const years = (await listYears()).map(y => y.label);

// RIGHT — 1× listYears
const { currentYear: YEAR, years } = await getYearContext();
```

## Batch payment/cohort helpers
`loadPaymentLites`, `loadPaymentLedger`, and `loadCohortPricing` all accept arrays of invoice IDs. Always collect all IDs first, then call once — never call them per invoice or per account inside a loop.
