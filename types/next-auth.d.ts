import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/db/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: Role[];
    } & DefaultSession["user"];
  }
  interface User {
    roles: Role[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: Role[];
    uid?: string;
  }
}
