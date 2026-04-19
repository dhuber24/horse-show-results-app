import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    role: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }
  interface Session {
    accessToken: string;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    error?: string;
  }
}
