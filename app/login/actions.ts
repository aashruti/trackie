"use server";

import { CredentialsSignin } from "next-auth";
import { signIn } from "@/lib/auth/config";

export interface LoginState {
  error?: string;
  /** Echoed back so a failed attempt doesn't make the user retype it. */
  email?: string;
}

/**
 * A wrong password is an EXPECTED error, not a bug, so it comes back as a return
 * value rather than a thrown exception (Next's error-handling guide: model
 * expected errors as return values, uncaught exceptions as throws). Letting
 * `signIn`'s `CredentialsSignin` escape is what put a crash page in front of
 * anyone who mistyped.
 *
 * Two things here are load-bearing:
 *
 * 1. `throw error` — on SUCCESS `signIn` redirects, and `redirect()` works by
 *    THROWING NEXT_REDIRECT. Swallowing every error would break logging in
 *    entirely.
 *
 * 2. Catching `CredentialsSignin` specifically, NOT its `AuthError` base. Some
 *    twenty classes extend AuthError — MissingSecret, AdapterError,
 *    JWTSessionError… Catching the base would tell a user "invalid email or
 *    password" when the real fault is a missing AUTH_SECRET, hiding a config
 *    break behind a message that blames them. Only a genuine credential
 *    rejection becomes a message; everything else stays an error.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      // Deliberately not distinguishing "no such user" from "wrong password" —
      // that difference tells an attacker which emails are registered.
      // The email (never the password) is echoed back: React resets the form
      // after an action, so without this the user retypes it every attempt.
      return { error: "Invalid email or password.", email };
    }
    throw error;
  }
  return {};
}
