'use client';

import { useState } from 'react';
import SelfCancelPolicy from '@/components/SelfCancelPolicy';
import { errorMessage } from '@/lib/api-error';

/** One company the caller works for, as `GET /my-company` returns it. No
 *  notes and no switches: those stand for what the company paid GaitDesk. */
export type StaffMember = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  added_at: string | null;
  is_me: boolean;
  is_owner: boolean;
};

export type StaffRequest = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  requested_at: string | null;
  /** 'signup': they typed the company's name when signing up. 'company':
   *  somebody here asked for them (migration 149). */
  source: 'signup' | 'company';
  /** Set once somebody here stands behind it — it then waits on GaitDesk. */
  vouched_by_name: string | null;
  vouched_at: string | null;
  vouched_by_me: boolean;
};

export type MyCompany = {
  id: string;
  name: string;
  personal: boolean;
  members: StaffMember[];
  join_requests: StaffRequest[];
  features: { key: string; label: string; plan: string }[];
  /** Days before a show's first day that exhibitors stop cancelling their own
   *  registration; 0 is until the show starts (migration 157). */
  self_cancel_days_before: number;
};

const ROLE_LABELS: Record<string, string> = {
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
};

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
      {children}
    </span>
  );
}

function CompanySection({
  company,
  onChange,
  onRemoved,
}: {
  company: MyCompany;
  onChange: (next: MyCompany) => void;
  /** A removal answers with every company the caller is still in. */
  onRemoved: (next: MyCompany[]) => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const send = async (url: string, init: RequestInit, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, fallback));
        return null;
      }
      return body;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const body = await send(
      `/api/my-company/${company.id}/members`,
      { method: 'POST', body: JSON.stringify({ email: address }) },
      'That request could not be sent.',
    );
    if (body) {
      onChange(body as MyCompany);
      setEmail('');
      setNotice(`Sent to GaitDesk. ${address} joins ${company.name} once an admin approves.`);
    }
  };

  const remove = async (member: StaffMember) => {
    const body = await send(
      `/api/my-company/${company.id}/members/${member.user_id}`,
      { method: 'DELETE' },
      member.is_me ? 'You could not leave the company.' : 'That account could not be removed.',
    );
    setConfirmRemove(null);
    if (body) onRemoved(body as MyCompany[]);
  };

  const answer = async (request: StaffRequest, approve: boolean) => {
    const withdrawing = !approve && Boolean(request.vouched_by_name);
    const body = await send(
      `/api/my-company/${company.id}/join-requests/${request.user_id}`,
      { method: approve ? 'POST' : 'DELETE' },
      approve ? 'The request could not be approved.' : 'The request could not be withdrawn.',
    );
    if (body) {
      onChange(body as MyCompany);
      setNotice(
        approve
          ? `Sent to GaitDesk. ${request.full_name} joins once an admin approves.`
          : withdrawing
            ? `Withdrew the request for ${request.full_name}.`
            : `Declined ${request.full_name}.`,
      );
    }
  };

  // The company's own policy, written outright — it hands nobody a feature.
  const savePolicy = async (daysBefore: number): Promise<string | null> => {
    const res = await fetch(`/api/my-company/${company.id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ self_cancel_days_before: daysBefore }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) return errorMessage(body, 'The cancellation policy could not be saved.');
    onChange(body as MyCompany);
    return null;
  };

  // Waiting on the company: somebody asked at sign-up and nobody here has
  // answered. Waiting on GaitDesk: somebody here stands behind it.
  const asking = company.join_requests.filter((r) => !r.vouched_by_name);
  const waiting = company.join_requests.filter((r) => r.vouched_by_name);

  return (
    <section className="border rounded-lg p-4 space-y-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{company.name}</h2>
          {company.personal && <Badge>Your own company</Badge>}
        </div>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {company.features.length > 0
            ? `Everyone here can use ${company.features.map((f) => f.label).join(', ')}.`
            : 'No paid features are switched on for this company.'}
        </p>
      </div>

      {asking.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Asking to join ({asking.length})
          </h3>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            They typed this company&apos;s name when they signed up. Approve only people who work for you —
            GaitDesk then confirms it, since everyone in the company gets its paid features.
          </p>
          <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
            {asking.map((request) => (
              <li key={request.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>{request.full_name}</div>
                  <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
                    {request.email} · {ROLE_LABELS[request.role] ?? request.role}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <button type="button" onClick={() => answer(request, true)} disabled={busy}
                    title="Sends it to GaitDesk to confirm"
                    className="px-3 py-1.5 rounded font-medium disabled:opacity-50" style={primaryButton}>
                    Approve
                  </button>
                  <button type="button" onClick={() => answer(request, false)} disabled={busy}
                    className="hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Waiting for GaitDesk ({waiting.length})
          </h3>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            A GaitDesk admin approves every new member, because everyone in the company gets its paid
            features. They join as soon as it is approved.
          </p>
          <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
            {waiting.map((request) => (
              <li key={request.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>{request.full_name}</div>
                  <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
                    {request.email} · {ROLE_LABELS[request.role] ?? request.role}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-deep)' }}>
                    {request.source === 'signup' ? 'Asked to join · approved by ' : 'Asked for by '}
                    {request.vouched_by_me ? 'you' : request.vouched_by_name}
                  </div>
                </div>
                <button type="button" onClick={() => answer(request, false)} disabled={busy}
                  className="text-sm hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Staff ({company.members.length})
        </h3>
        <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
          {company.members.map((member) => {
            const soleMember = member.is_me && company.members.length === 1;
            const blocked = member.is_owner
              ? 'This is their own company, named after them — they cannot be removed from it.'
              : soleMember
                ? 'You are the only person in this company. Add a colleague before you leave.'
                : null;
            return (
              <li key={member.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap" style={{ color: 'var(--foreground)' }}>
                    {member.full_name}
                    {member.is_me && <Badge>You</Badge>}
                  </div>
                  <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
                    {member.email} · {ROLE_LABELS[member.role] ?? member.role}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {confirmRemove === member.user_id ? (
                    <>
                      <button type="button" onClick={() => remove(member)} disabled={busy}
                        className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                        {member.is_me ? 'Confirm — leave' : 'Confirm remove'}
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)}
                        className="hover:underline" style={{ color: 'var(--muted)' }}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(member.user_id)}
                      disabled={busy || Boolean(blocked)}
                      title={blocked ?? undefined}
                      className="hover:underline disabled:opacity-40 disabled:no-underline"
                      style={{ color: 'var(--error)' }}
                    >
                      {member.is_me ? 'Leave' : 'Remove'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {confirmRemove && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {company.members.find((m) => m.user_id === confirmRemove)?.is_me
              ? 'You will lose this company’s paid features and stop working the shows it runs.'
              : 'They lose this company’s paid features and stop working the shows it runs. Their account is not affected.'}
          </p>
        )}
      </div>

      <form onSubmit={add} className="space-y-2">
        <label htmlFor={`add-staff-${company.id}`} className="block text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Add a staff member
        </label>
        <div className="flex gap-2 flex-wrap">
          <input
            id={`add-staff-${company.id}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email their account signs in with"
            autoComplete="off"
            className="border rounded px-3 py-2 text-sm flex-1 min-w-0"
            style={inputStyle}
          />
          <button type="submit" disabled={busy || !email.trim()}
            title={!email.trim() ? 'Type an email address first' : 'Sends it to GaitDesk to approve'}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
            {busy ? 'Working…' : 'Ask to add'}
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          A GaitDesk admin approves each new member. They need a show manager or show secretary account.
          {!company.personal && <> Somebody without one can sign up and type &ldquo;{company.name}&rdquo; as their company — their request will appear here.</>}
        </p>
      </form>

      {error && <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
      {notice && <p className="text-sm" style={{ color: 'var(--success-strong)' }}>{notice}</p>}

      {/* Below the people, since that is what this screen is mostly for; a
          policy is set once and left. */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <SelfCancelPolicy value={company.self_cancel_days_before ?? 0} onSave={savePolicy} />
      </div>
    </section>
  );
}

/**
 * My Company Staff — a show manager or secretary managing who works for their
 * show company (`routers/my_company.py`). Everyone in a company gets its paid
 * features, so nobody is added from here directly: asking to add a colleague,
 * or approving somebody who asked at sign-up, sends it to GaitDesk, and an
 * admin approves it (migration 149). Removing somebody who has left, and
 * leaving, take effect straight away.
 */
export default function MyCompanyStaff({ initialCompanies }: { initialCompanies: MyCompany[] }) {
  const [companies, setCompanies] = useState<MyCompany[]>(initialCompanies);

  if (companies.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        You are not in a show company yet. Message GaitDesk and they will set one up.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {companies.map((company) => (
        <CompanySection
          key={company.id}
          company={company}
          onChange={(next) => setCompanies((list) => list.map((c) => (c.id === next.id ? next : c)))}
          onRemoved={setCompanies}
        />
      ))}
    </div>
  );
}
