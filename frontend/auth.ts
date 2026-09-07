import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const API_URL = process.env.API_URL || 'http://backend:8000';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const res = await fetch(`${API_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });
          if (!res.ok) {
            // Auth.js intentionally turns a rejected credentials provider into
            // the generic CredentialsSignin response. Keep its user-facing
            // behavior, while preserving the backend status in server logs so
            // production configuration failures can be diagnosed safely.
            console.warn('Backend rejected credential verification request', {
              apiUrl: API_URL,
              status: res.status,
            });
            return null;
          }
          const user = await res.json();
          return user;
        } catch (error) {
          // Never log submitted credentials. The URL and error are sufficient
          // to distinguish DNS/TLS/connectivity failures from a bad password.
          console.error('Backend credential verification request failed', {
            apiUrl: API_URL,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
