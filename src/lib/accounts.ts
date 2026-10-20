/* Players log in with a username + 4-digit PIN. Firebase's free auth only does
 * email + password (6+ characters), so behind the scenes:
 *   username → an internal address that is never shown and never receives mail
 *   PIN      → a longer fixed-format password
 * Never change these two mappings once real accounts exist — existing logins would break.
 * Usernames are case-insensitive for login. */
const LOGIN_DOMAIN = "users.skipbo.local";
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const PIN_RE = /^\d{4}$/;

export function loginEmail(username: string): string {
  const u = username.trim();
  if (!USERNAME_RE.test(u)) throw new Error("Usernames are 3–20 letters, numbers, _ or -.");
  return `${u.toLowerCase()}@${LOGIN_DOMAIN}`;
}

export function pinPassword(pin: string): string {
  if (!PIN_RE.test(pin)) throw new Error("Your PIN is 4 digits.");
  return `skipbo-pin-${pin}`;
}
