// auth.users needs some email-shaped identifier to satisfy Supabase Auth,
// but NingAcademy has no real email/SMTP flow. This fixed placeholder
// domain is purely internal plumbing and is never shown to users.
const INTERNAL_EMAIL_DOMAIN = "users.ningacademy.internal";

export const USERNAME_REGEX = /^[A-Za-z0-9_-]{3,30}$/;

export function internalEmailFor(username: string): string {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`;
}
