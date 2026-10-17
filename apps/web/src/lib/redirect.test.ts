import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';

const HOME = '/dashboard';

describe('safeNextPath (?next= after login)', () => {
  it('keeps a same-site path with its query', () => {
    expect(safeNextPath('/leads?status=sale', HOME)).toBe('/leads?status=sale');
  });

  it('falls back when there is nothing to follow', () => {
    expect(safeNextPath(null, HOME)).toBe(HOME);
    expect(safeNextPath('', HOME)).toBe(HOME);
  });

  // Regression (independent review, M1): the previous check was
  // startsWith('/') && !startsWith('//'), which these slip through.
  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash, read as a slash by the URL parser', '/\\evil.com'],
    ['tab removed by the URL parser', '/\t/evil.com'],
    ['absolute URL', 'https://evil.com/login'],
    ['javascript: URL', 'javascript:alert(1)'],
  ])('rejects an off-site target: %s', (_label, next) => {
    expect(safeNextPath(next, HOME)).toBe(HOME);
  });
});
