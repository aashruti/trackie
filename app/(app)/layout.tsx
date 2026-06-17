import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Sidebar } from "@/components/shell/sidebar";
import { getCurrentYear } from "@/lib/dal/years";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const year = await getCurrentYear();

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar year={year} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
