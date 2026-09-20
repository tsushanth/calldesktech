// Dependency-free config helpers, safe to import from the Mac mini harness
// (which must not pull in the web app's auth stack).
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
