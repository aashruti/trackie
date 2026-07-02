import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/shell/sidebar";
import { isEmployee } from "@/lib/dal/hr/employees";
import pkg from "@/package.json";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  // Resilient: a transient DB error (or pre-migration state) must not 500 the
  // whole app shell — just hide the self-service "Me" nav until it recovers.
  const employee = await isEmployee(Number(user.id)).catch(() => false);

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        role={user.role}
        user={{ name: user.name, role: user.role }}
        version={pkg.version}
        isEmployee={employee}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
