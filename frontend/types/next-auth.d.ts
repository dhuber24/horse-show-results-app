import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role: 'ADMIN' | 'SHOW_MANAGER' | 'SHOW_SECRETARY' | 'SCRIBE' | 'GATE_STEWARD' | 'EXHIBITOR' | 'TRAINER';
    };
  }

  interface User {
    id: string;
    email: string;
    full_name: string;
    role: 'ADMIN' | 'SHOW_MANAGER' | 'SHOW_SECRETARY' | 'SCRIBE' | 'GATE_STEWARD' | 'EXHIBITOR' | 'TRAINER';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: 'ADMIN' | 'SHOW_MANAGER' | 'SHOW_SECRETARY' | 'SCRIBE' | 'GATE_STEWARD' | 'EXHIBITOR' | 'TRAINER';
  }
}
