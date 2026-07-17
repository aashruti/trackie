"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/config";

export interface LoginState {
  error?: string;
}

/**
 * A wrong password is an EXPECTED error, not a bug, so it comes back as a return
 * value rather than a thrown exception (Next's error-handling guide: model
 * expected errors as return values, uncaught exceptions as throws). Letting
 * `signIn`'s `CredentialsSignin` escape is what put a crash page in front of
 * anyone who mistyped.
 *
 * The `throw error` below is load-bearing: on SUCCESS `signIn` redirects, and
 * `redirect()` works by throwing NEXT_REDIRECT. Swallowing every error here
 * would break logging in entirely — only `AuthError` may be converted.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately not distinguishing "no such user" from "wrong password" —
      // that difference tells an attacker which emails are registered.
      return { error: "Invalid email or password." };
    }
    throw error;
  }
  return {};
}
