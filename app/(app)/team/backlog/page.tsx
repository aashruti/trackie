import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listTasksWithComments, listTaskOptions } from "@/lib/dal/tasks";
import { TeamBoard } from "@/components/team/team-board";
import { initials } from "@/lib/board/constants";

export default async function BacklogPage() {
  const session = await auth();
  const user = session!.user;

  const [tasks, options] = await Promise.all([
    listTasksWithComments({ statuses: ["backlog"] }),
    listTaskOptions(),
  ]);

  return (
    <>
      <Topbar section="Workspace" title="Backlog" user={user} />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        <TeamBoard
          tasks={tasks}
          accounts={options.accounts}
          users={options.users}
          meCode={initials(user.name ?? "U")}
          variant="backlog"
        />
      </main>
    </>
  );
}
