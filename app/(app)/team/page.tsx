import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listTasksWithComments, listTaskOptions, countTasksByStatus } from "@/lib/dal/tasks";
import { TeamBoard } from "@/components/team/team-board";
import { BOARD_STATUSES, initials } from "@/lib/board/constants";

export default async function TeamBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; assignee?: string; due?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const sp = await searchParams;

  // ?done=30 | 90 | all — how far back to keep completed tasks (default 30 days).
  const doneParam = sp.done ?? "30";
  const doneWithinDays = doneParam === "all" ? null : Number(doneParam) || 30;

  const [tasks, options, backlogCount] = await Promise.all([
    listTasksWithComments({ statuses: BOARD_STATUSES, doneWithinDays }),
    listTaskOptions(),
    countTasksByStatus("backlog"),
  ]);

  return (
    <>
      <Topbar section="Workspace" title="Team board" user={user} />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        <TeamBoard
          tasks={tasks}
          accounts={options.accounts}
          users={options.users}
          meCode={initials(user.name ?? "U")}
          variant="board"
          doneWindow={doneParam}
          backlogCount={backlogCount}
          initialAssignee={sp.assignee ?? "all"}
          initialDue={sp.due ?? "all"}
        />
      </main>
    </>
  );
}
