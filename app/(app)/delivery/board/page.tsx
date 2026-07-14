import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listTasksWithComments, listTaskOptions } from "@/lib/dal/tasks";
import { TeamBoard } from "@/components/team/team-board";
import { TASK_COLUMNS, initials } from "@/lib/board/constants";
import { TASK_STATUSES } from "@/lib/db/enums";
import { canAccessDelivery } from "@/lib/dal/authz";

export default async function DeliveryBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; assignee?: string; due?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const actor = { id: Number(user.id), role: user.role };
  const sp = await searchParams;

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Delivery board" user={user} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">The delivery board is available to the Delivery team / Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const doneParam = sp.done ?? "30";
  const doneWithinDays = doneParam === "all" ? null : Number(doneParam) || 30;

  const [tasks, options] = await Promise.all([
    // All six columns on one screen (backlog included) — delivery triages in place.
    listTasksWithComments({ statuses: [...TASK_STATUSES], doneWithinDays, board: "delivery" }),
    listTaskOptions(),
  ]);

  return (
    <>
      <Topbar section="Delivery" title="Delivery board" user={user} />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        <TeamBoard
          tasks={tasks}
          accounts={options.accounts}
          users={options.users}
          programs={options.programs}
          meCode={initials(user.name ?? "U")}
          variant="board"
          board="delivery"
          basePath="/delivery/board"
          columns={TASK_COLUMNS}
          doneWindow={doneParam}
          initialAssignee={sp.assignee ?? "all"}
          initialDue={sp.due ?? "all"}
        />
      </main>
    </>
  );
}
