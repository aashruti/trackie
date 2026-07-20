import { describe, it, expect } from "vitest";
import { shouldSkipAsPreview } from "./preview-guard";

/**
 * The rule this encodes: a Vercel PREVIEW deployment must not run migrations,
 * because Preview and Production share a DATABASE_URL — so migrating from a
 * preview build alters the production schema on every push to a PR. That is
 * how migration 0016 reached production before its PR was reviewed.
 *
 * The predicate lives in its own module precisely so this file can import it
 * without executing db-migrate's top-level work (dotenv, the DATABASE_URL
 * check, main()). Importing the runner instead would start a real migration
 * against the developer's database on every `npm test`.
 */
describe("preview deployments must not migrate", () => {
  it("skips on a preview deployment", () => {
    expect(shouldSkipAsPreview({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("does NOT skip on a production deployment", () => {
    expect(shouldSkipAsPreview({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("does NOT skip off-platform (local CLI runs, where VERCEL_ENV is unset)", () => {
    expect(shouldSkipAsPreview({})).toBe(false);
  });

  it("does NOT skip when VERCEL_ENV is unset on a Vercel build", () => {
    // The catastrophic direction: if VERCEL_ENV were ever missing on a
    // production deploy, the guard must stay OFF so migrations still run.
    expect(shouldSkipAsPreview({ VERCEL: "1" })).toBe(false);
  });

  it("does NOT skip a Vercel development deployment", () => {
    expect(shouldSkipAsPreview({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("honours the opt-out once previews get their own database", () => {
    expect(
      shouldSkipAsPreview({ VERCEL_ENV: "preview", ALLOW_PREVIEW_MIGRATIONS: "1" }),
    ).toBe(false);
  });

  it('only exactly "1" opts out — a stray truthy value must not re-enable it', () => {
    for (const v of ["true", "0", "", "yes"]) {
      expect(shouldSkipAsPreview({ VERCEL_ENV: "preview", ALLOW_PREVIEW_MIGRATIONS: v })).toBe(true);
    }
  });
});
