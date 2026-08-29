// Providers rejected as personal/free email accounts — everything else is treated as a work
// email. This is a simple allowlist-by-exclusion, not a real domain verification.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'live.com',
  'msn.com',
  'yandex.com',
]);

export function isWorkEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && !PERSONAL_EMAIL_DOMAINS.has(domain);
}
