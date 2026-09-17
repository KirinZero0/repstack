import bcrypt from "bcryptjs";

// Fixed bcrypt hash of a random value — used to run a real bcrypt.compare() even when no
// account was found, so response timing doesn't reveal whether the email/account exists.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8kRjBd0Sap6YHu5AZR8oh6z3VYQhwq";

/** Always performs a bcrypt.compare() of equivalent cost, regardless of whether `hash` is real. */
export async function compareOrDummy(password: string, hash: string | null | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
