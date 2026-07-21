import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditList } from "./audit-list";
import type { AuditEntry } from "@/lib/dal/audit-log";

/**
 * What the expanded diff panel actually SAYS about a bare version bump.
 *
 * The DAL tests prove the classification; this file proves the sentence, which
 * is where the harm lived: the panel asserted, in prose, that the column which
 * moved "is therefore one the trigger redacts: password_hash, aadhar or pan" —
 * on every table, including the 1,365 real rows sitting on tables that have
 * never held any of those columns. A boolean can be wrong quietly; this claim
 * was wrong out loud, to a reader who came to the audit log precisely because
 * they needed to trust it.
 *
 * JSX-free (`createElement`) and server-rendered to a string so the test runs
 * in the existing `environment: "node"` setup with no jsdom and no change to
 * vitest's `**\/*.test.ts` include glob.
 */

const BASE: AuditEntry = {
  id: 1,
  at: new Date("2026-07-20T10:00:00Z"),
  tableName: "invoices",
  op: "UPDATE",
  rowId: "42",
  actorId: 7,
  actorName: "Aashruti",
  before: { id: 42, version: 1 },
  after: { id: 42, version: 2 },
  changedFields: [
    { key: "updated_at", before: "t1", after: "t2" },
    { key: "version", before: 1, after: 2 },
  ],
  isStampOnly: false,
  isRedactedOnly: false,
  isPreGuardStamp: false,
};

function render(entry: Partial<AuditEntry>): string {
  return renderToStaticMarkup(
    createElement(AuditList, { entries: [{ ...BASE, ...entry }] }),
  );
}

/** The credential claim, in the words the panel uses to make it. */
function claimsCredentialChange(html: string): boolean {
  return html.includes("one the trigger redacts");
}

describe("AuditList — the bare version bump", () => {
  it("does not claim a credential change on a table with no redactable column", () => {
    const html = render({ tableName: "invoices", isPreGuardStamp: true });

    expect(claimsCredentialChange(html)).toBe(false);
    // Nor may the three column names appear at all: naming them here is the
    // insinuation even without the sentence around them.
    expect(html).not.toContain("password_hash");
    expect(html).not.toContain("aadhar");
    // ">pan<", not "pan": the page is full of <span>.
    expect(html).not.toContain(">pan<");
  });

  it("describes it honestly instead — an unexplained bump, nothing hidden", () => {
    const html = render({ tableName: "invoices", isPreGuardStamp: true });

    expect(html).toContain("without recording a change to any other column");
    expect(html).toContain("Nothing was hidden");
    expect(html).toContain("stamp_row()");
    // The honest note names the table it is talking about.
    expect(html).toContain("invoices");
  });

  it("still makes the credential claim where it is TRUE — on users", () => {
    // The other half of the guarantee: the fix must not buy its honesty by
    // going silent on the highest-signal event the log records.
    const html = render({ tableName: "users", isRedactedOnly: true });

    expect(claimsCredentialChange(html)).toBe(true);
    expect(html).toContain("password_hash");
    // …and only the column users actually owns.
    expect(html).not.toContain("aadhar");
  });

  it("names aadhar and pan on employee_profiles, not password_hash", () => {
    const html = render({ tableName: "employee_profiles", isRedactedOnly: true });

    expect(claimsCredentialChange(html)).toBe(true);
    expect(html).toContain("aadhar");
    expect(html).toContain(">pan<");
    expect(html).not.toContain("password_hash");
  });
});

describe("AuditList — the empty diff", () => {
  const empty = { changedFields: [], before: { id: 42 }, after: { id: 42 } };

  it("raises the stripped-columns caveat only where such a column exists", () => {
    const onUsers = render({ ...empty, tableName: "users" });
    expect(onUsers).toContain("stripped from");
    expect(onUsers).toContain("password_hash");
  });

  it("does not raise it on a table that has nothing to strip", () => {
    // "Note that password_hash … can never appear here" reads, on an invoice,
    // as a hint that something might have been. Nothing could have been.
    const onInvoices = render({ ...empty, tableName: "invoices" });
    expect(onInvoices).not.toContain("stripped from");
    expect(onInvoices).not.toContain("password_hash");
    expect(onInvoices).toContain("The two stored row images are identical");
  });
});
