import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { SCORING_ROLES } from '@/lib/scoring-access';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const role = (session?.user as any)?.role;

  // Protect admin routes
  if (pathname.startsWith('/admin')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Protect gate steward routes
  if (pathname === '/gate' || pathname.startsWith('/gate/')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (!['GATE_STEWARD', 'ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Protect scribe routes. The show office does a scribe's work at its own
  // shows; which shows is the page's and the backend's to check, not this.
  if (pathname.includes('/scribe')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (!SCORING_ROLES.includes(role)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/admin/:path*', '/shows/:path*/scribe', '/gate', '/gate/:path*'],
};
