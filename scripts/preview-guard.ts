/**
 * Should this process skip migrations because it is a Vercel PREVIEW build?
 *
 * `vercel-build` runs the migration runner on every deployment, including the
 * preview built for each push to a PR. Preview and Production share one
 * DATABASE_URL, so migrating from a preview build alters the PRODUCTION schema
 * on every push — that is how migration 0016 reached production days before its
 * PR was reviewed. Schema changes should land when a PR merges and Production
 * deploys, which is when they were reviewed.
 *
 * Deliberately side-effect free (no dotenv, no DATABASE_URL check, no db
 * client) so it can be imported and unit-tested without starting a migration.
 *
 * Note `VERCEL_ENV` is "preview" for custom named environments too. If one of
 * those is ever given its own database, set ALLOW_PREVIEW_MIGRATIONS=1 on it.
 */
export function shouldSkipAsPreview(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  // Exactly "1" — a stray "true"/"yes"/"0" must not silently re-enable
  // production-schema mutation from previews.
  return env.ALLOW_PREVIEW_MIGRATIONS !== "1";
}

/** The message shown when a preview build declines to migrate. */
export const PREVIEW_SKIP_MESSAGE =
  "Preview deployment — skipping migrations.\n" +
  "Preview and Production share a DATABASE_URL here, so migrating from a\n" +
  "preview build would alter the production schema on every push to a PR.\n" +
  "Schema changes land when the PR merges and Production deploys.\n" +
  "Set ALLOW_PREVIEW_MIGRATIONS=1 once previews have their own database.";
