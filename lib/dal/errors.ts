/**
 * A validation / business-rule error whose message is safe to show the end user
 * (e.g. "Insufficient balance", "already reviewed"). Server actions surface the
 * message of a UserError but replace any OTHER thrown error with a generic
 * string — so internal DB/driver errors never leak to the client.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function isUserError(e: unknown): e is UserError {
  return e instanceof UserError;
}
