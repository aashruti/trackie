# Delivery PO and payment tracking: design

Date: 2026-11-04. Status: awaiting approval.

Decisions are marked **(user)** where Kunal stated or approved them in conversation, and **(builder call)** where the author settled a detail that Kunal has not specifically reviewed.

## Why

POs arrive from vendors and list deliverables. The delivery team turns those deliverables into events, runs them and bills the vendor. Today Trackie has no record of the PO itself or of whether the money came in, so the team cannot answer "has this PO been paid?" from the app.

A second problem comes from history. Programs were created per university, so one program may combine several real POs. The team needs a way to separate these without re-entering events.

## Goals

1. Treat each program as one PO, and store the PO's details and document on it. **(user)**
2. Record payments received against a PO, and attach proofs as they arrive. **(user)**
3. Show at a glance whether a PO has been paid. **(user)**
4. Create a new PO from selected existing events. **(user)**

## Non-goals

- **SME and vendor PIs, and payments Datagami makes against them.** Originally requested, but deferred to a second phase with its own design. **(user)**
- Tracking invoices or billed amounts. Only money received is tracked in this phase. **(builder call)**
- Line items on the PO. The sample PO's lines (unit price × count) are not entered; the attached file holds them, and events remain the deliverables. **(builder call)**
- Tracking the delivery paperwork a PO asks for, such as attendance sheets or certificates. **(builder call)**
- Reading PO files automatically (OCR or AI extraction).
- Reporting POs or payments on the dashboard, the renewal report or the finance screens.
- Payment reminders or overdue alerts.

## Anti-goals

These would make the feature a failure even if it works:

- A proof or PO file reachable by public URL, or by anyone outside the access rules below.
- A split that loses, duplicates or misattributes events, activities or spend.
- A partial split left behind by a failure part way through.
- Recorded payments disappearing as a side effect of another action.

## Who can use it

Delivery team and super-admins only, using the existing `canAccessDelivery` and `canManageDelivery`. **(user)** Sales, HR and finance screens gain nothing.

Delivery users stay scoped to their assigned universities. Every read, write and file download must apply the same account scope as existing delivery code (`lib/dal/delivery/scope.ts`). A program outside a user's scope reads as not found.

## PO details on a program

Each program gets these optional fields, editable on the program detail screen: **(user, field list approved in playback)**

- PO number
- PO date
- PO value before GST, in rupees, as totalled from the PO's line items. POs may not print a grand total or any GST, so the user adds up the lines. **(builder call, based on the sample PO)**
- GST rate, defaulting to 18% **(builder call, rate to be confirmed by Kunal)**
- Vendor: who issued the PO and is billed. Free text that suggests names already used. This is separate from Provider, because the sample PO for an IBM program came from a reseller, with payment terms tied to that reseller being paid by IBM. **(builder call, based on the sample PO)**
- PO documents: one or more attached files **(builder call: more than one, so amendments can be kept)**

Existing programs start blank and are filled in over time. New programs do not require PO details, because work can start before the paper arrives. **(builder call)**

PO numbers are not forced to be unique, because different universities can legitimately issue the same number. When a number is saved that already exists on another program with the same account and provider, the screen shows a warning but still saves. The check never looks outside the user's account scope, so it cannot reveal hidden programs. **(builder call)**

A PO always covers one university, so PO details live on the program and no separate PO record is needed. **(user)**

The UI renames Programs to POs throughout, for example the "POs" screen and "+ New PO". Events and Provider keep their names. **(user)** Renames apply to on-screen labels only: database tables, code identifiers and routes keep their current names. This document says "program" when referring to the data record.

### PO value and event budgets

These stay independent. **(user)** The PO value does not change or limit any event budget, and event budgets do not change the PO value. The program detail screen shows PO value, total event budget and the difference, with the difference highlighted when budgets exceed the PO value. Nothing is blocked. The existing optional `total_budget` field is untouched.

The comparison with event budgets uses PO value before GST.

### Amount due and GST

Vendors are billed for the PO's items plus GST. **(user)** Amount due = PO value × (1 + GST rate), calculated when read and shown on the PO. For example, ₹10,00,000 at 18% gives ₹11,80,000 due.

## Payments received

A program has zero or more payments. Each has: **(user, approved in playback)**

- Date received (required)
- Amount received in the bank, greater than zero (required)
- TDS deducted, zero or more (optional, defaults to 0)
- Reference, such as a UTR or cheque number (optional)
- Note (optional)
- Proof files: zero or more **(builder call: more than one, as a bank advice and a TDS certificate may arrive separately)**

When a vendor pays a lump sum against several POs, it is entered as one payment per PO. The same reference is allowed on several payments, and the proof is attached to each. **(user)**

Proofs can be added to an existing payment at any time, because they often arrive later than the money. Payments can be edited and deleted by anyone who can manage delivery. Deleting a payment also deletes its proof files.

The app stores no running balance. Totals are calculated when read, matching how delivery spend already works.

### Payment status

Settled amount = sum of (amount received + TDS) across the program's payments.

| Status | Condition |
|---|---|
| No PO value | PO value is blank and nothing has been recorded |
| Not received | PO value is set and settled amount is 0 |
| Part received | Settled amount is above 0 and more than ₹1 below amount due |
| Fully received | Settled amount is within ₹1 of amount due, to absorb rounding **(builder call)** |
| Over received | Settled amount is more than ₹1 above amount due |

If payments exist but PO value is blank, show the status as "Value missing" along with the amount, so the record is visible and prompts someone to fill it in. **(builder call for this row and "Over received")**

Status is calculated, never stored or set by hand. **(user)**

## Screens

**Programs list** (`components/delivery/programs-explorer.tsx`):

- New columns for PO number, vendor and payment status, with settled amount against amount due.
- New payment status and vendor filters alongside the existing filters. **(user for status; builder call for vendor)**
- The stat strip gains amount due, received and outstanding totals for the filtered rows. Outstanding counts only programs with a PO value, and never goes below 0 for any one program. **(builder call)**
- Rupee figures are shown in full, never abbreviated or hidden behind a tooltip, per the existing app-wide rule.

**Program detail** (`components/delivery/program-detail.tsx`):

- A "Purchase order" section with the PO fields, documents, PO value against event budgets, and status.
- A "Payments received" section listing payments with their proofs, plus add, edit and delete.
- A "Move to new PO" action on the events list. Viewing PO files and payments follows the access rule above; all changes require `canManageDelivery`.

## Create a new PO from existing events

From a program, the user selects one or more events and chooses "Move to new PO". **(user)**

The dialog asks for the new program's name (required) and optional PO number, date, value, GST rate and vendor. If the source program has payments, it also lists them so the user can tick any that belong to the new PO. **(builder call)**

The result:

- A new program with the same account, provider and teaching style as the source. Status is copied. Start and end dates are the earliest start and latest end of the moved events. **(user for the same account, provider and style; builder call for the rest)**
- Selected events move with all their activities, costs, owners and statuses unchanged. Ticked payments move with their proofs.
- The source program's event, budget and spend totals drop by exactly what moved. Its PO fields, documents, dates and `total_budget` stay as they are; the screen reminds the user to review them.
- Board tasks linked to the source program stay on it, because tasks link to programs rather than events. **(user)**
- The user lands on the new program.
- The result dialog offers no undo. Events can be moved back through the same action only if the builder adds "move to an existing program", which is out of scope for now. **(builder call)**

Moving every event is allowed and leaves the source program empty but intact.

**The split must be all or nothing.** `lib/db/client.ts` uses the Neon HTTP driver in production, which has no interactive transactions, and `db.transaction()` works locally but breaks on deploy (see the note in `lib/dal/user-admin.ts`). Use one atomic SQL statement (a data-modifying CTE) or an equivalent the production driver supports, and test it against that constraint. All selected events and payments must belong to the source program, and the source must be in the user's scope, or the whole action fails.

## Files

- **Storage:** the existing Azure Blob helper in `lib/storage/blob.ts`, in the existing private container, under a new path prefix such as `delivery/programs/<programId>/`. **(user: existing Azure storage)**
- **Access:** files open only through an authenticated app route that checks delivery access and account scope, then streams the bytes. Raw blob URLs are never sent to the browser. **(user)** Serve with a correct content type and `X-Content-Type-Options: nosniff`; display inline only for PDF and images, and use the stored file name for downloads.
- **Allowed types:** PDF, JPG, PNG. **(builder call)** Validate on the server. Sanitise stored paths so that a user's file name cannot influence them unsafely.
- **Size limit:** 4 MB per file, rejected with a clear message. **(builder call)** Vercel Functions reject request bodies above 4.5 MB, and Next server actions default to a 1 MB body limit, so whichever upload path is chosen must really accept 4 MB in production. The `attendance` upload's 8 MB check is not a safe precedent.
- **Storage not configured:** when `isStorageConfigured()` is false, PO fields and payments still work, and upload controls show a clear message.
- **Deleting a file** removes the database row and the blob. If blob removal fails, the row is still removed and the failure is logged; an orphaned blob is unreachable through the app and is acceptable. **(builder call)**

## Deletion rules

- A program with recorded payments cannot be deleted through the program delete action; the user must remove the payments first. The message says so. **(builder call)** This protects against the anti-goal of payments vanishing.
- A program without payments deletes as it does today, and its PO documents are removed from storage on a best-effort basis.
- Account deletion continues to cascade through programs, payments and file rows. Blobs left behind this way are accepted, and the finance `deleteAccount` code does not need to learn about them, in keeping with the existing comment on `programs.accountId`.
- Deleting an event is unaffected by payments, because payments belong to the program.

## Project rules that apply

- Schema changes go through a Drizzle migration in `drizzle/` with a journal entry, applied locally with `npx tsx scripts/db-migrate.ts`. Never use `--prod`. New tables carry `...baseColumns` and the `trg_audit` trigger, like `email_signatures` in `0026_email_signatures_audit.sql`.
- Money is stored in `numeric` columns, like existing delivery money fields.
- No N+1 queries: the Programs list loads payment totals for all programs in one query. Independent queries use `Promise.all`.
- This repo's Next.js differs from the common version. Read `node_modules/next/dist/docs/` before writing route handlers or server actions.
- Follow the delivery DAL's existing conventions for actor stamping (`updatedBy`, `stampedDelete`) so that audit rows name the right person.

## Branching

Build on a new branch from `main`, which now includes the email signature work and its migrations up to 0027. The new migration is 0028. The provider filter in aashruti/trackie#53 touches `programs-explorer.tsx` and should merge first or be rebased over.

## Left to the builder

- Exact table and column names, and whether PO files and proofs share one table.
- Upload mechanism, provided it meets the size and access rules above.
- Layout and component details, in the style of the existing delivery screens.
- Test structure, following existing `lib/dal/delivery/*.test.ts`. At minimum, cover: status calculation at each boundary, scope enforcement on reads, writes and file downloads, an atomic split that fails cleanly, and the deletion rule.
