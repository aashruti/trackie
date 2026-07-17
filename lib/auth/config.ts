import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "./password";
import { createSession, sessionExists, deleteSession } from "@/lib/dal/sessions";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (c) => {
        const email = String(c?.email ?? "");
        const password = String(c?.password ?? "");
        if (!email || !password) return null;
        const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!u || !(await verifyPassword(password, u.passwordHash))) return null;
        return { id: String(u.id), name: u.name, email: u.email, role: u.role };
      },
    }),
  ],
  callbacks: {
    // Enforced by middleware: unauthenticated requests to matched routes are
    // redirected to the sign-in page.
    authorized: ({ auth }) => !!auth?.user,
    /**
     * Revocation. On sign-in we mint a session row and record its id on the
     * token; every later request checks the row still exists. Returning null
     * makes Auth.js clear the cookie (@auth/core/lib/actions/session.js:54).
     *
     * This costs one primary-key lookup per auth() call — middleware and every
     * Server Component — so the JWT is no longer stateless. That is the price of
     * revocation, accepted deliberately (see the spec).
     */
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.uid = user.id;
        token.sid = await createSession(Number(user.id));
        return token;
      }
      const sid = token.sid as string | undefined;
      // No sid → a token minted before this shipped. Reject it: it predates the
      // session store and cannot be revoked, so honouring it would leave a hole
      // open for the life of the old token.
      if (!sid) return null;

      // FAILS CLOSED, deliberately (spec §3a). No try/catch: the store is the
      // source of truth for whether a session is live, so if it cannot be
      // reached the session is not honoured. Auth.js calls this callback inside
      // a try whose catch clears the cookie (actions/session.js:58) and cannot
      // tell an outage from a forged token — so a DB error signs the user out,
      // and a wide outage signs out everyone at once. That is the accepted
      // trade: revocation must never be delayed, even at the cost of
      // availability. If users report random logouts, look here first.
      if (!(await sessionExists(sid))) return null;
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
  events: {
    // Clean sign-out: drop the row rather than leaving it to leak (spec §4).
    signOut: async (message) => {
      const sid = "token" in message ? (message.token?.sid as string | undefined) : undefined;
      if (sid) await deleteSession(sid);
    },
  },
});
