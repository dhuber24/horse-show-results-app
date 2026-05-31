import AcceptInviteClient from './AcceptInviteClient';

type InvitePayload = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  show_id: string | null;
  show_name: string | null;
  expires_at: string;
  status: string;
};

async function fetchInvite(token: string): Promise<InvitePayload | { error: string }> {
  const apiUrl = process.env.API_URL || 'http://backend:8000';
  const internalApiKey = process.env.INTERNAL_API_KEY || '';
  const res = await fetch(
    `${apiUrl}/user-invites/by-token/${encodeURIComponent(token)}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': internalApiKey,
      },
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    return { error: res.status === 404 ? 'Invite not found.' : 'Could not load invite.' };
  }
  return res.json();
}

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await fetchInvite(token);

  if ('error' in result) {
    return (
      <main className="max-w-md mx-auto p-6 mt-12">
        <div
          className="rounded border p-6 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          {result.error}
        </div>
      </main>
    );
  }

  if (result.status !== 'pending') {
    const label =
      result.status === 'accepted'
        ? 'This invite has already been accepted. Sign in with the password you set.'
        : result.status === 'expired'
          ? 'This invite has expired. Ask the show secretary to send a new one.'
          : result.status === 'cancelled'
            ? 'This invite has been cancelled.'
            : `This invite is ${result.status}.`;
    return (
      <main className="max-w-md mx-auto p-6 mt-12">
        <div
          className="rounded border p-6 text-sm"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.text }}
        >
          {label}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto p-6 mt-12 space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: COLORS.text }}>
        Welcome, {result.first_name}.
      </h1>
      <p className="text-sm" style={{ color: COLORS.muted }}>
        You&apos;ve been invited to scorekeep
        {result.show_name ? ` for ${result.show_name}` : ''}. Set a password to
        finish creating your account.
      </p>
      <div
        className="rounded border p-3 text-sm space-y-1"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.text }}
      >
        <p>
          <span style={{ color: COLORS.muted }}>Name:</span>{' '}
          {result.first_name} {result.last_name}
        </p>
        <p>
          <span style={{ color: COLORS.muted }}>Email:</span> {result.email}
        </p>
        <p>
          <span style={{ color: COLORS.muted }}>Role:</span> {result.role}
        </p>
      </div>
      <AcceptInviteClient token={token} />
    </main>
  );
}
