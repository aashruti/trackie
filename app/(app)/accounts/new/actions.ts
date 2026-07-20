"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { createAccount, type NewAccount } from "@/lib/dal/account-admin";

export async function createAccountAction(input: NewAccount) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const { id } = await createAccount(
    { id: Number(session.user.id), roles: session.user.roles },
    input,
  );
  revalidatePath("/accounts");
  redirect(`/accounts/${id}`);
}
