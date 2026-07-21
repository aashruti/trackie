import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { getYearContext } from "@/lib/dal/years";
import {
  AUDIT_ACTOR_NONE,
  listAuditEntries,
  listAuditFilterOptions,
  type AuditFilters as AuditFilterValues,
  type AuditOp,
} from "@/lib/dal/audit-log";
import { AuditFilters } from "@/components/admin/audit-filters";
import { AuditList } from "@/components/admin/audit-list";
import { AuditPager } from "@/components/admin/audit-pager";

type Params = {
  table?: string;
  actor?: string;
  op?: string;
  from?: string;
  to?: string;
  page?: string;
  stamps?: string;
};

const OPS: AuditOp[] = ["INSERT", "UPDATE", "DELETE"];
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Turn the URL into DAL filters, dropping anything malformed rather than
 * erroring. A hand-edited query string is a hostile-ish input on an admin page:
 * the right response is to ignore the junk and still render the feed.
 */
function parseFilters(sp: Params): AuditFilterValues {
  const filters: AuditFilterValues = {};

  if (sp.table) filters.tableName = sp.table;

  if (sp.actor === AUDIT_ACTOR_NONE) {
    filters.actorId = AUDIT_ACTOR_NONE;
  } else if (sp.actor) {
    const id = Number(sp.actor);
    if (Number.isInteger(id) && id > 0) filters.actorId = id;
  }

  if (sp.op && (OPS as string[]).includes(sp.op)) filters.op = sp.op as AuditOp;

  // Dates arrive as YYYY-MM-DD from <input type="date">. `from` is the start of
  // that day and `to` its LAST instant — a bare `to` of midnight would silently
  // exclude everything that happened on the day the reader asked for.
  if (sp.from && ISO_DATE.test(sp.from)) filters.from = new Date(`${sp.from}T00:00:00.000`);
  if (sp.to && ISO_DATE.test(sp.to)) filters.to = new Date(`${sp.to}T23:59:59.999`);

  return filters;
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** The current filters as a query string, minus `page` — for the pager links. */
function filterQuery(sp: Params): string {
  const out = new URLSearchParams();
  for (const key of ["table", "actor", "op", "from", "to", "stamps"] as const) {
    const v = sp[key];
    if (v) out.set(key, v);
  }
  return out.toString();
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();

  if (!user.roles.includes("super-admin")) {
    return (
      <>
        <Topbar section="Admin" title="Audit log" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Only a Super Admin can view the audit log.</p>
        </main>
      </>
    );
  }

  const actor = { id: Number(user.id), roles: user.roles };
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const page = parsePage(sp.page);
  const showStampOnly = sp.stamps === "1";

  const [feed, options] = await Promise.all([
    listAuditEntries(actor, filters, page),
    listAuditFilterOptions(actor),
  ]);

  // The stamp-only fold is PRESENTATION, applied here and never in SQL — the
  // log itself must stay complete, and folding in the query would also make
  // `hasMore` lie about what the next page holds. The cost is that a page can
  // render fewer than 50 rows; the pager says how many were folded so the
  // count never looks like a bug.
  const visible = showStampOnly ? feed.entries : feed.entries.filter((e) => !e.isStampOnly);
  const hiddenStampOnly = feed.entries.length - visible.length;

  return (
    <>
      <Topbar section="Admin" title="Audit log" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Audit log</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Every insert, update and delete recorded by the database triggers, newest first. Expand
            an entry for its changed-field diff.
          </p>
          <p className="mt-1.5 text-xs text-text-muted">
            Secrets and identity numbers (<span className="font-mono">password_hash</span>,{" "}
            <span className="font-mono">aadhar</span>, <span className="font-mono">pan</span>) are
            stripped by the trigger before a row image is stored, so they never appear below —
            including when they did change.
          </p>
        </div>

        <AuditFilters options={options} showStampOnly={showStampOnly} />

        <Card>
          <AuditList entries={visible} />
          <AuditPager
            page={feed.page}
            hasMore={feed.hasMore}
            shown={visible.length}
            hiddenStampOnly={hiddenStampOnly}
            query={filterQuery(sp)}
          />
        </Card>
      </main>
    </>
  );
}
