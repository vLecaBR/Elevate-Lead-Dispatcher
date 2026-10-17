// Where to go after login, from ?next=. Only paths on this same site are followed.
// The check goes through the URL parser itself: string tests like startsWith('/') are
// fooled by inputs the parser reads differently ("/\evil.com" or "/<tab>/evil.com" both
// resolve to evil.com), which would turn the login page into an open redirect.
const PLACEHOLDER_ORIGIN = 'http://same-site.invalid';

export function safeNextPath(next: string | null, fallback: string): string {
  if (!next) {
    return fallback;
  }
  try {
    const url = new URL(next, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) {
      return fallback;
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
