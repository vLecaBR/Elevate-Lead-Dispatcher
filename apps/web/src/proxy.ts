import { type NextRequest, NextResponse } from 'next/server';

// Optimistic check only (Next.js 16 "proxy", formerly middleware): without a session cookie
// there is no point rendering an app page. The real check is the API, on every call.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('sid')) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // App pages only: not the login page, the API rewrite or static assets.
  matcher: ['/', '/dashboard/:path*', '/leads/:path*', '/admin/:path*'],
};
