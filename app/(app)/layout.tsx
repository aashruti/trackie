import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/shell/sidebar";
import pkg from "@/package.json";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar
        roles={user.roles}
        user={{ name: user.name, roles: user.roles }}
        version={pkg.version}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
