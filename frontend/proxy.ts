import { auth } from '@/auth';
import { NextResponse } from 'next/server';

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

  // Protect scorekeeper routes
  if (pathname.includes('/scorekeeper')) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (role !== 'SCOREKEEPER' && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/admin/:path*', '/shows/:path*/scorekeeper'],
};
