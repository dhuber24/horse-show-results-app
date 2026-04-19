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
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });
          if (!res.ok) return null;
          const data = await res.json();

          // Decode JWT payload to extract user info without an extra round-trip
          const [, payloadB64] = data.access_token.split('.');
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

          return {
            id: payload.sub,
            email: payload.email,
            name: payload.full_name,
            role: payload.role,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.expiresAt = (user as any).expiresAt;
        return token;
      }

      // Return token unchanged if still valid (60s buffer)
      if (Date.now() / 1000 < (token.expiresAt as number) - 60) {
        return token;
      }

      // Silently refresh the access token
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: token.refreshToken }),
        });
        if (!res.ok) throw new Error('Refresh failed');
        const refreshed = await res.json();
        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          error: undefined,
        };
      } catch {
        return { ...token, error: 'RefreshTokenError' };
      }
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
