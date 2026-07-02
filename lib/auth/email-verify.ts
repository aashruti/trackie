import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless email-verification tokens: HMAC-signed with AUTH_SECRET, 24h expiry,
 * with the email bound in so a token is void if the address later changes. No DB
 * table needed — verification just sets users.email_verified_at.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function makeVerifyToken(userId: number, email: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${userId}:${email}:${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyVerifyToken(token: string): { userId: number; email: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const p = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // payload = userId:email:exp (email never contains ':')
  const first = payload.indexOf(":");
  const last = payload.lastIndexOf(":");
  if (first < 1 || last <= first) return null;
  const userId = Number(payload.slice(0, first));
  const email = payload.slice(first + 1, last);
  const exp = Number(payload.slice(last + 1));
  if (!userId || !exp || Date.now() > exp) return null;
  return { userId, email };
}
