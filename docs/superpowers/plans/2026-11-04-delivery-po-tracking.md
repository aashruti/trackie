# Delivery PO and Payment Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the delivery team store a PO on each program, record payments and proofs against it, see its payment status, and split existing events into a new PO.

**Architecture:** PO fields live on `programs`. Payments and files are two new audited tables keyed to a program. Totals and status are calculated on read by one pure function. Files go through two authenticated route handlers to the existing private Azure container. The split is one atomic SQL statement, because the production driver has no transactions.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, PostgreSQL (postgres.js locally, Neon HTTP in production), Azure Blob Storage, Vitest against a local database.

**Spec:** `docs/superpowers/specs/2026-11-04-delivery-po-tracking-design.md`

## Global Constraints

- Access: `canAccessDelivery` to read and `canManageDelivery` to change, plus account scope on every read, write and download. Out of scope reads as not found.
- Never call `db.transaction()`: it passes locally and breaks on deploy.
- Never migrate production by hand, and never pass `--prod`. Local migration: `VERCEL="" npx tsx scripts/db-migrate.ts`, because `.env.production.local` sets `VERCEL=1`, which selects the wrong driver for local scripts. Use the same `VERCEL=""` prefix for `npx vitest`.
- No queries inside loops over rows; independent queries use `Promise.all`.
- New tables use `...baseColumns` and both the `trg_stamp` and `trg_audit` triggers. Writes set `updatedBy`, and deletes use `stampedDelete` or `stampedDeleteWhere`.
- Rupee figures always show in full through `components/ui/money`, with no abbreviation or value-hiding tooltip.
- UI says "PO" where it said "program". Database names, code identifiers and URLs stay as they are.
- GST rate defaults to 18. Allowed files are PDF, JPG and PNG, up to 4 MB (4 × 1024 × 1024 bytes). Fully received means within ₹1 of amount due.
- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before writing route handlers; this Next.js differs from common versions.
- Work in a worktree on a new branch from `main`, and commit as the repo's configured `aashruti` user. Never commit on `feat/email-signature`.

## Review Focus

1. **Money typed in Indian format,** such as `4,31,340`, is accepted as 431340. Pinned in Task 1.
2. **A GST rate of 0 stays 0** and is not replaced by the 18 default. Pinned in Task 1 and Task 3.
3. **PO value edited or cleared after payments exist:** status recalculates, and clearing shows Value missing with payments kept. Pinned in Task 3.
4. **Stale split:** a selected event or payment has already moved, so the whole split fails and nothing changes. Pinned in Task 5.
5. **Awkward uploads:** a renamed `.exe`, an empty file, exactly 4 MB, one byte over, and Hindi or quote characters in file names all behave correctly and can't break the download header. Pinned in Task 4.

---

### Task 1: Status calculation and input parsing

**Files:**
- Create: `lib/delivery/po-status.ts` (pure, no `server-only`, so client components can import it)
- Test: `lib/delivery/po-status.test.ts`

**Interfaces:**
- Produces:
  - `type PaymentStatus = "no_value" | "value_missing" | "not_received" | "part_received" | "fully_received" | "over_received"`
  - `type PoTotals = { due: number | null; settled: number; outstanding: number; status: PaymentStatus }`
  - `computePoTotals(input: { poValue: number | null; gstRate: number; received: number; tds: number }): PoTotals`
  - `parseMoneyInput(raw: string): number | null`: blank gives `null`; commas and a leading `₹` are stripped; anything unparseable gives `NaN`
  - `DEFAULT_GST_RATE = 18`

- [ ] **Step 1: Write the failing tests**

```ts
const t = (poValue: number | null, received = 0, tds = 0, gstRate = 18) =>
  computePoTotals({ poValue, gstRate, received, tds });

it("works out amount due from PO value and GST", () => {
  expect(t(431340).due).toBe(508981.2);
  expect(t(431340, 0, 0, 0).due).toBe(431340);
});
it("reports each status at its boundary", () => {
  expect(t(null).status).toBe("no_value");
  expect(t(null, 5000).status).toBe("value_missing");
  expect(t(100000).status).toBe("not_received");
  expect(t(100000, 117998.99).status).toBe("part_received");
  expect(t(100000, 117999).status).toBe("fully_received");
  expect(t(100000, 118001).status).toBe("fully_received");
  expect(t(100000, 118001.01).status).toBe("over_received");
});
it("counts TDS towards the settled amount", () => {
  const r = t(100000, 108000, 10000);
  expect(r.settled).toBe(118000);
  expect(r.status).toBe("fully_received");
});
it("never reports negative or rounding-only outstanding", () => {
  expect(t(100000, 50000).outstanding).toBe(68000);
  expect(t(100000, 118500).outstanding).toBe(0);
  expect(t(100000, 117999.5).outstanding).toBe(0);
  expect(t(null, 5000).outstanding).toBe(0);
});
it("rounds to paise so floats don't change the status", () => {
  expect(t(0.1 + 0.2, 0, 0, 0).due).toBe(0.3);
});
it("parses money the way people type it", () => {
  expect(parseMoneyInput("4,31,340")).toBe(431340);
  expect(parseMoneyInput("₹ 1,000.50")).toBe(1000.5);
  expect(parseMoneyInput("  ")).toBeNull();
  expect(parseMoneyInput("abc")).toBeNaN();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `VERCEL="" npx vitest run lib/delivery/po-status.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/delivery/po-status.ts`**

Round `due` and `settled` to 2 decimals. Order of checks: blank value, then settled 0, then within ₹1 inclusive, then above, else part. `outstanding` is 0 unless status is `not_received` or `part_received`.

- [ ] **Step 4: Run to verify they pass**

Run: `VERCEL="" npx vitest run lib/delivery/po-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/delivery/po-status.ts lib/delivery/po-status.test.ts
git commit -m "feat(delivery): calculate PO payment status"
```

### Task 2: Schema and migration

**Files:**
- Modify: `lib/db/schema.ts` (after `deliveryActivities`, and the `programs` table)
- Create: `drizzle/0028_program_po_tracking.sql`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces, in `schema.ts`:
  - `programs` gains `poNumber` (`po_number` text), `poDate` (`po_date` date), `poValue` (`po_value` numeric), `gstRate` (`gst_rate` numeric, not null, default 18), `vendor` (text). All are nullable except `gstRate`.
  - `programPayments` (`program_payments`): `id`, `...baseColumns`, `programId` (not null, FK cascade), `receivedDate` (`received_date` date not null), `amount` (numeric not null), `tds` (numeric not null default 0), `reference` (text), `note` (text). Checks: `amount > 0`, `tds >= 0`. Index on `program_id`.
  - `programFiles` (`program_files`): `id`, `...baseColumns`, `programId` (not null, FK cascade), `paymentId` (`payment_id`, nullable, FK to `program_payments` cascade; null means a PO document), `fileName` (`file_name` text not null), `pathname` (text not null), `contentType` (`content_type` text not null), `sizeBytes` (`size_bytes` integer not null). Indexes on `program_id` and `payment_id`.

- [ ] **Step 1: Check migration order**

`main` is at `0027` (`when` 1787904000000), now that PR 52 has merged. Use idx 28, file `0028_program_po_tracking`, and journal `when` `1788000000000`, because the migrator only applies entries newer than the last applied timestamp.

- [ ] **Step 2: Write the SQL and schema**

Follow `drizzle/0025_email_signatures.sql` for table style and `0026_email_signatures_audit.sql` for triggers, with `--> statement-breakpoint` between statements. Add both triggers to both new tables. Do not add triggers to `programs`, which already has them.

- [ ] **Step 3: Apply and verify**

Run: `VERCEL="" npx tsx scripts/db-migrate.ts`. Read the printed host first; it must be local.

Run: `VERCEL="" npx vitest run lib/dal/delivery/programs.test.ts`
Expected: the migration applies and existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/0028_program_po_tracking.sql drizzle/meta/_journal.json
git commit -m "feat(delivery): add PO fields, payments and files tables"
```

### Task 3: PO and payment data layer

**Files:**
- Create: `lib/dal/delivery/po.ts`
- Create: `lib/dal/delivery/po.test.ts` (fixtures as in `programs.test.ts`: unique `RUN` names, one in-scope and one out-of-scope delivery user)
- Modify: `lib/dal/delivery/programs.ts` (`ProgramListRow`, `ProgramDetail`, `PROGRAM_SELECT`, `loadRollups`, `listPrograms`, `getProgramDetail`, `deleteProgram`)
- Modify: `lib/dal/delivery/scope.ts`
- Modify: `app/(app)/delivery/programs/[id]/actions.ts`

**Interfaces:**
- Consumes: `computePoTotals`, `PoTotals`, `DEFAULT_GST_RATE` from Task 1.
- Produces, in `po.ts`:
  - `type PoInput = { poNumber?: string | null; poDate?: string | null; poValue?: number | null; gstRate?: number | null; vendor?: string | null }`
  - `cleanPoInput(input: PoInput)`: validates and trims. `poValue` must be above 0 if present. `gstRate` must be 0 to 100, and only `null` or `undefined` falls back to 18.
  - `updateProgramPo(user, programId, input: PoInput): Promise<{ duplicates: { id: number; name: string }[] }>`: saves, then returns other programs with the same PO number, same account and same provider. Blank numbers aren't compared.
  - `type NewPayment = { programId: number; receivedDate: string; amount: number; tds?: number; reference?: string | null; note?: string | null }`
  - `addPayment(user, input: NewPayment): Promise<{ id: number }>`
  - `updatePayment(user, id, input: Omit<NewPayment, "programId">): Promise<void>`
  - `deletePayment(user, id): Promise<void>`: removes file rows and blobs too, using best-effort blob deletion that logs failures
  - `listVendorOptions(user): Promise<string[]>`: distinct and scoped
  - `type ProgramFileRow = { id: number; paymentId: number | null; fileName: string; contentType: string; sizeBytes: number }`
  - `type ProgramPayment = { id: number; receivedDate: string; amount: number; tds: number; reference: string | null; note: string | null; proofs: ProgramFileRow[] }`
  - `loadProgramPo(programId: number): Promise<{ payments: ProgramPayment[]; documents: ProgramFileRow[] }>`: internal, no authorization, for callers that have already checked
- Produces, in `programs.ts`:
  - `ProgramListRow` gains `poNumber`, `poDate`, `poValue`, `gstRate`, `vendor` and `po: PoTotals`
  - `ProgramDetail` gains `payments: ProgramPayment[]` and `documents: ProgramFileRow[]`
- Produces, in `scope.ts`: `assertPaymentInScope(user, paymentId)` and `assertFileInScope(user, fileId)`, modelled on `assertEventInScope`.
- Produces, in `actions.ts`: `updateProgramPoAction`, `addPaymentAction`, `updatePaymentAction`, `deletePaymentAction`, each using the existing `session()`, `revalidateProgram` and `ActionResult` pattern. `updateProgramPoAction` returns `{ ok: true; duplicates: { id: number; name: string }[] }` on success.

- [ ] **Step 1: Write the failing tests**

Test names, each with concrete values:
- `saves PO fields, and updateProgram leaves them untouched`
- `keeps a GST rate of 0`
- `rejects a PO value of 0, and a GST rate of 101`
- `warns about a repeated PO number on the same account and provider, but still saves`
- `doesn't warn across accounts, or about a program outside the caller's scope`
- `rejects a payment of 0, a negative TDS, and a bad date`
- `lists status from payments: 100000 at 18% with 50000 received and 8000 TDS is part_received with 60000 outstanding`
- `recalculates when PO value changes after payments, and clearing it gives value_missing with payments kept`
- `allows the same reference on two payments`
- `delivery user out of scope can't read, add, edit or delete payments`
- `viewer and sales can't read or write`
- `listVendorOptions returns only names from the caller's scope`
- `deleteProgram refuses while payments exist, then succeeds once they're removed`
- `audit rows for deleted payments name the deleter`

- [ ] **Step 2: Run to verify they fail**

Run: `VERCEL="" npx vitest run lib/dal/delivery/po.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Extend `loadRollups` with a third grouped query on `program_payments` returning `sum(amount)` and `sum(tds)` as text, and compute `po` in `listPrograms` with `computePoTotals`. In `getProgramDetail`, add `loadProgramPo` to the existing parallel fetch where it doesn't depend on another result. Group files into payments in JS, with one query for all files of the program.

In `deleteProgram`, after the scope check: refuse with `UserError("This PO has payments recorded. Remove them first.")` if any exist, read file pathnames, stamp `program_files`, delete as today, then delete blobs best-effort.

- [ ] **Step 4: Run to verify they pass**

Run: `VERCEL="" npx vitest run lib/dal/delivery`
Expected: PASS, including existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dal/delivery "app/(app)/delivery/programs/[id]/actions.ts"
git commit -m "feat(delivery): record PO details and payments"
```

### Task 4: File upload and download

**Files:**
- Create: `lib/delivery/upload-rules.ts`, `lib/delivery/upload-rules.test.ts`
- Create: `lib/dal/delivery/po-files.ts`, `lib/dal/delivery/po-files.test.ts`
- Create: `app/api/delivery/programs/[id]/files/route.ts` (POST)
- Create: `app/api/delivery/files/[fileId]/route.ts` (GET)
- Modify: `lib/storage/blob.ts` (header comment only, as it's no longer HR-only)
- Modify: `app/(app)/delivery/programs/[id]/actions.ts`

**Interfaces:**
- Consumes: `programFiles`, `assertFileInScope`, `assertProgramInScope`, `lib/storage/blob.ts`.
- Produces:
  - `MAX_FILE_BYTES = 4 * 1024 * 1024`
  - `checkUpload(bytes: Uint8Array, fileName: string): { ok: true; contentType: string; ext: string } | { ok: false; error: string }`: decides type from the leading bytes, not from the name or the browser's claim. PDF is `%PDF`, JPG is `FF D8 FF`, PNG is `89 50 4E 47`.
  - `contentDisposition(fileName: string, inline: boolean): string`: an ASCII fallback plus RFC 5987 `filename*`, safe for quotes, newlines and non-Latin characters
  - `storeProgramFile(user, input: { programId: number; paymentId: number | null; fileName: string; bytes: Uint8Array }): Promise<ProgramFileRow>`
  - `getProgramFileForDownload(user, fileId): Promise<{ fileName: string; contentType: string; bytes: Buffer } | null>`: null when missing or out of scope
  - `deleteProgramFile(user, fileId): Promise<void>`
  - `deleteProgramFileAction(programId, fileId)`, in `actions.ts`
- POST takes multipart fields `file` and optional `paymentId`, and returns `201` with the file row, or `{ error }` with 400, 401, 404 or 503. GET returns the bytes, or 401 or 404. Both set `runtime = "nodejs"` and `preferredRegion = "sin1"`, as `app/api/search/route.ts` does.

- [ ] **Step 1: Write the failing tests**

In `upload-rules.test.ts`:
```ts
const pdf = (size: number) => { const b = new Uint8Array(size); b.set([0x25,0x50,0x44,0x46]); return b; };
expect(checkUpload(pdf(MAX_FILE_BYTES), "po.pdf").ok).toBe(true);
expect(checkUpload(pdf(MAX_FILE_BYTES + 1), "po.pdf").ok).toBe(false);
expect(checkUpload(new Uint8Array(0), "po.pdf").ok).toBe(false);
expect(checkUpload(new Uint8Array([0x4d,0x5a,0,0]), "fake.pdf").ok).toBe(false);
expect(checkUpload(pdf(10), "renamed.exe")).toMatchObject({ ok: true, contentType: "application/pdf", ext: "pdf" });
expect(contentDisposition('a"b\r\nc.pdf', false)).not.toMatch(/[\r\n]/);
expect(contentDisposition("पीओ.pdf", true)).toMatch(/^inline; .*filename\*=UTF-8''/);
```

In `po-files.test.ts`, mock `@/lib/storage/blob` with an in-memory map:
- `stores under delivery/programs/<id>/ with a generated name, ignoring the user's file name`
- `a proof's payment must belong to the same program`
- `removes the blob if the database insert fails`
- `delivery user out of scope gets null from download and an error from upload and delete`
- `deleting a file removes the row even when blob removal fails`
- `reports a clear error when storage isn't configured`

- [ ] **Step 2: Run to verify they fail**

Run: `VERCEL="" npx vitest run lib/delivery/upload-rules.test.ts lib/dal/delivery/po-files.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Stored path: `delivery/programs/${programId}/${randomUUID()}.${ext}`. Check `isStorageConfigured()` first. The GET handler always sets `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. Display inline for all three allowed types. Route handlers only authenticate and translate errors; authorization stays in the data layer.

- [ ] **Step 4: Run to verify they pass**

Run: `VERCEL="" npx vitest run lib/delivery lib/dal/delivery/po-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/delivery lib/dal/delivery/po-files* lib/storage/blob.ts app/api/delivery "app/(app)/delivery/programs/[id]/actions.ts"
git commit -m "feat(delivery): attach PO documents and payment proofs"
```

### Task 5: Split events into a new PO

**Files:**
- Modify: `lib/dal/delivery/po.ts`, `lib/dal/delivery/po.test.ts`
- Modify: `app/(app)/delivery/programs/[id]/actions.ts`

**Interfaces:**
- Consumes: `cleanPoInput`, `assertProgramInScope`.
- Produces:
  - `moveToNewPo(user, sourceId: number, input: { name: string; eventIds: number[]; paymentIds?: number[] } & PoInput): Promise<{ id: number }>`
  - `moveToNewPoAction(sourceId, input)`, returning `{ ok: true; id: number } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

- `moves selected events with activities, leaving other events behind, and totals add up to the original`
- `copies account, provider, teaching style and status; dates span the moved events, treating a blank end as the start date`
- `moves ticked payments and their proofs, and proofs still download`
- `leaves the source's PO fields, documents, total budget and linked board tasks alone`
- `can move every event, leaving the source empty but intact`
- `fails with no changes when an event belongs to another program, or was already moved`
- `fails with no changes when a payment belongs to another program`
- `rejects an empty selection and a blank name`
- `delivery user out of scope can't split, and the audit rows name the mover`
- `runs without db.transaction` (assert by spying that `db.transaction` isn't called)

- [ ] **Step 2: Run to verify they fail**

Run: `VERCEL="" npx vitest run lib/dal/delivery/po.test.ts -t "move"`
Expected: FAIL.

- [ ] **Step 3: Implement as one `db.execute(sql\`...\`)` statement**

```sql
WITH src AS (SELECT * FROM programs WHERE id = :source),
ok AS (
  SELECT 1 WHERE (SELECT count(*) FROM delivery_events
                  WHERE id = ANY(:eventIds) AND program_id = :source) = :eventCount
             AND (SELECT count(*) FROM program_payments
                  WHERE id = ANY(:paymentIds) AND program_id = :source) = :paymentCount
),
new_p AS (
  INSERT INTO programs (account_id, oem_id, delivery_method_id, name, status,
                        start_date, end_date, po_number, po_date, po_value, gst_rate, vendor,
                        created_by, updated_by)
  SELECT account_id, oem_id, delivery_method_id, :name, status,
         (SELECT min(start_date) FROM delivery_events WHERE id = ANY(:eventIds)),
         (SELECT max(coalesce(end_date, start_date)) FROM delivery_events WHERE id = ANY(:eventIds)),
         :poNumber, :poDate, :poValue, :gstRate, :vendor, :actor, :actor
  FROM src WHERE EXISTS (SELECT 1 FROM ok)
  RETURNING id
),
ev AS (UPDATE delivery_events SET program_id = (SELECT id FROM new_p), updated_by = :actor
       WHERE id = ANY(:eventIds) AND EXISTS (SELECT 1 FROM new_p) RETURNING id),
pay AS (UPDATE program_payments SET program_id = (SELECT id FROM new_p), updated_by = :actor
        WHERE id = ANY(:paymentIds) AND EXISTS (SELECT 1 FROM new_p) RETURNING id),
fil AS (UPDATE program_files SET program_id = (SELECT id FROM new_p), updated_by = :actor
        WHERE payment_id = ANY(:paymentIds) AND EXISTS (SELECT 1 FROM new_p) RETURNING id)
SELECT id FROM new_p;
```

De-duplicate the id arrays before counting. No returned row means validation failed: throw `UserError("Some of those events or payments have already moved. Refresh and try again.")`. The two drivers return different shapes, so read rows with `Array.isArray(res) ? res : res.rows`. Cast array parameters to `int[]` explicitly, because an empty `paymentIds` otherwise has no type.

- [ ] **Step 4: Run to verify they pass**

Run: `VERCEL="" npx vitest run lib/dal/delivery/po.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dal/delivery/po.ts lib/dal/delivery/po.test.ts "app/(app)/delivery/programs/[id]/actions.ts"
git commit -m "feat(delivery): split events into a new PO"
```

### Task 6: PO screen sections and split dialog

**Files:**
- Create: `components/delivery/po-panel.tsx` ("Purchase order" and "Payments received" sections)
- Create: `components/delivery/move-to-new-po-dialog.tsx`
- Modify: `components/delivery/meta.ts` (add `PAYMENT_STATUS_META`, in the same shape as `PROGRAM_STATUS_META`)
- Modify: `components/delivery/program-detail.tsx` (`EventsPanel` gains selection checkboxes and a "Move to new PO" button)
- Modify: `app/(app)/delivery/programs/[id]/page.tsx` (render `PoPanel` above `ProgramDetailView`; load `listVendorOptions`; pass `isStorageConfigured()`)

**Interfaces:**
- Consumes: the `ProgramDetail` additions, the actions from Tasks 3 to 5, `POST /api/delivery/programs/[id]/files`, `GET /api/delivery/files/[fileId]`, `parseMoneyInput`, `MAX_FILE_BYTES`.
- `PAYMENT_STATUS_META` labels: No PO value, Value missing, Not received, Part received, Fully received, Over received.

- [ ] **Step 1: Build `PoPanel`**

Shows PO number, date, vendor (with a `<datalist>` of `listVendorOptions`), PO value before GST, GST rate and the status pill. Shows amount due, received, TDS, outstanding, and PO value against event budgets, with the difference highlighted when budgets exceed PO value. Shows a duplicate warning with links when the save returns `duplicates`. Lists documents with add and delete.

Payments list has add, edit and delete, and add-proof on each row. Parse money with `parseMoneyInput`. Check size in the browser as well, with the message "That file is too large (max 4 MB)". When storage isn't configured, replace upload controls with a short explanation. Controls that change data show only with `canManage`.

- [ ] **Step 2: Build the split flow**

Checkboxes appear on event cards only when `canManage`. The button is disabled until one event is selected. The dialog asks for name (required), PO number, date, value, GST rate and vendor, and lists source payments as tick boxes when any exist. It states that this can't be undone, and that the source PO's details stay as they are. On success, go to the new PO's page.

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit -p . && npx eslint components/delivery "app/(app)/delivery"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/delivery "app/(app)/delivery/programs/[id]/page.tsx"
git commit -m "feat(delivery): manage POs, payments and splits on screen"
```

### Task 7: POs list columns and filters

**Files:**
- Modify: `components/delivery/programs-explorer.tsx`

**Interfaces:**
- Consumes: `ProgramListRow.poNumber`, `.vendor`, `.po`, and `PAYMENT_STATUS_META`.

- [ ] **Step 1: Add columns and filters**

Columns: PO number, Vendor, and payment status with `settled / due`, using the `Money` component. Filters: payment status, and vendor built from the rows, following the existing filter pattern. If the provider filter from PR 53 is on the branch, keep it. Widen the table's `min-w` as needed, because the table scrolls rather than hiding values.

Stat strip gains Amount due, Received and Outstanding, summed over filtered rows, with `received` being each row's `po.settled` and rows with a blank PO value adding 0 to due and outstanding.

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit -p . && npx eslint components/delivery/programs-explorer.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/delivery/programs-explorer.tsx
git commit -m "feat(delivery): show PO and payment status on the list"
```

### Task 8: Rename Programs to POs on screen

**Files:**
- Modify: `components/shell/sidebar.tsx`, `components/delivery/programs-explorer.tsx`, `new-program-dialog.tsx`, `program-controls.tsx`, `program-detail.tsx`, `accounts-explorer.tsx`, `delivery-dashboard.tsx`, the pages under `app/(app)/delivery`, and user-facing `UserError` text in `lib/dal/delivery`
- Modify: any test asserting the old wording

- [ ] **Step 1: List every candidate**

Run: `grep -rnE "[Pp]rogram" components/shell components/delivery "app/(app)/delivery" lib/dal/delivery components/team 2>/dev/null | grep -vE "import |programId|programs\.|Program[A-Z]|\.test\."`

- [ ] **Step 2: Change only text a person reads**

Examples: "Programs" to "POs", "+ New program" to "+ New PO", "Search programs…" to "Search POs…", "Delete program" to "Delete PO", "Give the program a name." to "Give the PO a name.". Identifiers, routes and `program_id` stay. Also fix the stale "Delivery team / Admin / Super Admin" message in `app/(app)/delivery/programs/[id]/page.tsx`, which should read "Delivery team / Super Admin".

- [ ] **Step 3: Run all delivery tests and checks**

Run: `VERCEL="" npx vitest run lib/dal/delivery lib/delivery && npx tsc --noEmit -p . && npm run lint`
Expected: PASS. Update tests only where wording changed.

- [ ] **Step 4: Commit**

```bash
git add components "app/(app)/delivery" lib/dal/delivery
git commit -m "feat(delivery): call programs POs on screen"
```

### Task 9: End-to-end check and PR

**Files:** none expected, other than fixes.

- [ ] **Step 1: Run the whole suite and build**

Run: `VERCEL="" npm test && npm run build`
Expected: PASS, apart from any failures that also occur on `main`; report those rather than hiding them.

- [ ] **Step 2: Walk through it in the browser as a delivery user**

Needs a local delivery test account, and a browser session that isn't the user's own. If that isn't possible without signing the user out, stop and ask. Using the sample PO's figures on a local test program:
1. Enter PO value 431340 at 18%, and see ₹5,08,981.20 due and Not received.
2. Attach the PDF, open it, and confirm the raw blob URL never appears in the page or network log.
3. Add a part payment with a proof, and see Part received with the right outstanding.
4. Add the remainder, and see Fully received.
5. Select events, move them to a new PO with a payment, and confirm both POs' totals.
6. Filter the list by status, vendor and provider.
7. Try deleting a PO with payments, and see it refused.

If Azure isn't configured locally, say that upload and download weren't exercised against real storage.

- [ ] **Step 3: Push and open the PR against `main`**

Record what was and wasn't verified in the PR body, and call out the migration-order note from Task 2.
