'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { StaffMember, StaffRequest } from '@/app/admin/my-company/MyCompanyStaff';

/** A company the caller may run the show under. */
export type CompanyChoice = { id: string; name: string; personal: boolean };

/** A manager or secretary working this show from outside its company. */
export type ShowGuest = { user_id: string; full_name: string; email: string; role: string };

/** `GET /shows/{id}/company-staff` (`routers/show_company_staff.py`). */
export type ShowCompanyStaffPayload = {
  company: {
    id: string;
    name: string;
    /** Somebody's own company (migration 143) rather than an organization. */
    personal: boolean;
    members: StaffMember[];
    join_requests: StaffRequest[];
  } | null;
  /** Admin, or somebody in the company. A guest on the show changes nothing about it. */
  can_manage: boolean;
  /** An admin's additions take effect at once; everybody else's wait for one. */
  adds_directly: boolean;
  can_change: boolean;
  choices: CompanyChoice[];
  suggested_company_id: string | null;
  guests: ShowGuest[];
};

type Account = { id: string; full_name: string; email: string; role: string };

const ROLE_LABELS: Record<string, string> = {
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
};

const card = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;
const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;
const listStyle = { borderColor: 'var(--border-subtle)' } as const;

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
      {children}
    </span>
  );
}

function PersonLine({ name, email, role, badge }: { name: string; email: string; role: string; badge?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-medium flex items-center gap-2 flex-wrap" style={{ color: 'var(--foreground)' }}>
        {name}
        {badge}
      </div>
      <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
        {email} · {ROLE_LABELS[role] ?? role}
      </div>
    </div>
  );
}

/**
 * Setup Step 1's staff, drawn from the company that runs the show (migration
 * 156). Everybody in the company works the show, so this list *is* the
 * company's: adding or removing somebody here changes who works for the
 * company, on every show it runs — the same list as My Company Staff, through
 * the same rules. Adding is a request a GaitDesk admin approves (migration
 * 149), unless an admin is the one adding.
 *
 * Below it, anybody working this show from outside the company — a guest
 * secretary hired for the weekend — on the per-show assignment they always had.
 * Scribes and gate stewards are hired per show and stay in `ShowStaffPanel`.
 */
export default function ShowCompanyStaff({
  showId,
  initial,
  availableManagers,
  availableSecretaries,
  isAdmin,
}: {
  showId: string;
  initial: ShowCompanyStaffPayload;
  /** Approved SHOW_MANAGER accounts, from `/users/by-role`, for the guest picker. */
  availableManagers: Account[];
  availableSecretaries: Account[];
  isAdmin: boolean;
}) {
  const [staff, setStaff] = useState<ShowCompanyStaffPayload>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [pick, setPick] = useState<string>(initial.suggested_company_id ?? '');

  const company = staff.company;

  /** Every write answers with the whole payload; one request at a time. */
  async function send(url: string, init: RequestInit, fallback: string): Promise<{ ok: boolean; status: number }> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, fallback));
        return { ok: false, status: res.status };
      }
      if (body && typeof body === 'object' && 'guests' in body) setStaff(body as ShowCompanyStaffPayload);
      return { ok: true, status: res.status };
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const res = await fetch(`/api/shows/${showId}/company-staff`, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (res.ok && body) setStaff(body as ShowCompanyStaffPayload);
  }

  async function chooseCompany(companyId: string) {
    const target = staff.choices.find((c) => c.id === companyId);
    const { ok } = await send(
      `/api/shows/${showId}/company`,
      { method: 'PUT', body: JSON.stringify({ company_id: companyId }) },
      'The show could not be put under that company.',
    );
    if (ok) {
      setChanging(false);
      setNotice(`${target?.name ?? 'The company'} runs this show now. Everyone in it works the show.`);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    const address = email.trim();
    if (!address) return;
    const { ok, status } = await send(
      `/api/shows/${showId}/company-staff`,
      { method: 'POST', body: JSON.stringify({ email: address }) },
      'That request could not be sent.',
    );
    if (ok) {
      setEmail('');
      setNotice(
        status === 201
          ? `Added ${address} to ${company.name}. They work this show now.`
          : `Sent to GaitDesk. ${address} joins ${company.name} — and works this show — once an admin approves.`,
      );
    }
  }

  async function removeMember(member: StaffMember) {
    if (!company) return;
    const { ok } = await send(
      `/api/shows/${showId}/company-staff/${member.user_id}`,
      { method: 'DELETE' },
      'That account could not be removed.',
    );
    setConfirmRemove(null);
    if (ok) setNotice(`Removed ${member.full_name} from ${company.name}.`);
  }

  async function answer(request: StaffRequest, approve: boolean) {
    if (!company) return;
    const withdrawing = !approve && Boolean(request.vouched_by_name);
    const { ok, status } = await send(
      `/api/shows/${showId}/company-staff/requests/${request.user_id}`,
      { method: approve ? 'POST' : 'DELETE' },
      approve ? 'The request could not be approved.' : 'The request could not be withdrawn.',
    );
    if (!ok) return;
    setNotice(
      approve
        ? status === 202
          ? `Sent to GaitDesk. ${request.full_name} joins once an admin approves.`
          : `Added ${request.full_name} to ${company.name}.`
        : withdrawing
          ? `Withdrew the request for ${request.full_name}.`
          : `Declined ${request.full_name}.`,
    );
  }

  // Waiting on the company: somebody asked at sign-up and nobody here has
  // answered. Waiting on GaitDesk: somebody in the company stands behind it.
  const asking = company?.join_requests.filter((r) => !r.vouched_by_name) ?? [];
  const waiting = company?.join_requests.filter((r) => r.vouched_by_name) ?? [];
  const otherChoices = staff.choices.filter((c) => c.id !== company?.id);

  const companyPicker = (onCancel?: () => void) => (
    <div className="flex gap-2 flex-wrap items-center">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label="Company that runs this show"
        className="border rounded px-3 py-2 text-sm flex-1 min-w-0"
        style={inputStyle}
      >
        <option value="" disabled>Choose a company…</option>
        {(company ? otherChoices : staff.choices).map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.personal ? ' (independent)' : ''}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => pick && chooseCompany(pick)}
        disabled={busy || !pick}
        title={!pick ? 'Choose a company first' : undefined}
        className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        style={primaryButton}
      >
        {company ? 'Move the show' : 'Run it under this company'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="p-5 rounded-lg border space-y-4" style={card}>
        {company ? (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Run by</span>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>{company.name}</h3>
                  {company.personal && <Badge>Independent</Badge>}
                </div>
                {staff.can_change && otherChoices.length > 0 && !changing && (
                  <button
                    type="button"
                    onClick={() => { setChanging(true); setPick(''); }}
                    className="text-sm hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Change company
                  </button>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Everyone at {company.name} works this show, and every other show it runs. Adding or
                removing someone here changes {company.name}&apos;s own staff, the same list
                as <Link href="/admin/my-company" className="underline">My Company Staff</Link>.
              </p>
            </div>

            {changing && (
              <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--warning-bg)' }}>
                <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                  Moving the show changes who works it. Everyone at the new company works it, and
                  {' '}{company.name}&apos;s staff stop unless they are also listed below as working this show.
                </p>
                {companyPicker(() => setChanging(false))}
              </div>
            )}

            {!staff.can_manage && (
              <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                You work this show as a guest, so only {company.name}&apos;s own staff can change this list.
              </p>
            )}

            {staff.can_manage && asking.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  Asking to join ({asking.length})
                </h4>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  They typed {company.name} as their company when they signed up. Approve only people who work for you.
                  {!staff.adds_directly && ' GaitDesk then confirms it, since everyone in the company gets its paid features.'}
                </p>
                <ul className="divide-y rounded border" style={listStyle}>
                  {asking.map((request) => (
                    <li key={request.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2" style={listStyle}>
                      <PersonLine name={request.full_name} email={request.email} role={request.role} />
                      <div className="flex items-center gap-3 text-sm">
                        <button type="button" onClick={() => answer(request, true)} disabled={busy}
                          title={staff.adds_directly ? `Adds them to ${company.name}` : 'Sends it to GaitDesk to confirm'}
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
                <h4 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  Waiting for GaitDesk ({waiting.length})
                </h4>
                <ul className="divide-y rounded border" style={listStyle}>
                  {waiting.map((request) => (
                    <li key={request.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2" style={listStyle}>
                      <div className="min-w-0">
                        <PersonLine name={request.full_name} email={request.email} role={request.role} />
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-deep)' }}>
                          {request.source === 'signup' ? 'Asked to join · approved by ' : 'Asked for by '}
                          {request.vouched_by_me ? 'you' : request.vouched_by_name}
                        </div>
                      </div>
                      {staff.can_manage && (
                        <div className="flex items-center gap-3 text-sm">
                          {staff.adds_directly && (
                            <button type="button" onClick={() => answer(request, true)} disabled={busy}
                              className="px-3 py-1.5 rounded font-medium disabled:opacity-50" style={primaryButton}>
                              Approve
                            </button>
                          )}
                          <button type="button" onClick={() => answer(request, false)} disabled={busy}
                            className="hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                            {staff.adds_directly ? 'Decline' : 'Withdraw'}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                {company.name} staff ({company.members.length})
              </h4>
              {company.members.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Nobody works for {company.name} yet.</p>
              ) : (
                <ul className="divide-y rounded border" style={listStyle}>
                  {company.members.map((member) => {
                    const blocked = member.is_me
                      ? `To leave ${company.name}, use My Company Staff. From here it would also take you off this show.`
                      : member.is_owner
                        ? 'This is their own company, named after them. They cannot be removed from it.'
                        : null;
                    return (
                      <li key={member.user_id} className="px-3 py-2 space-y-1" style={listStyle}>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <PersonLine
                            name={member.full_name}
                            email={member.email}
                            role={member.role}
                            badge={member.is_me ? <Badge>You</Badge> : undefined}
                          />
                          {staff.can_manage && (
                            <div className="flex items-center gap-3 text-sm">
                              {confirmRemove === member.user_id ? (
                                <>
                                  <button type="button" onClick={() => removeMember(member)} disabled={busy}
                                    className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                                    Confirm remove
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
                                  Remove
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {confirmRemove === member.user_id && (
                          <p className="text-xs" style={{ color: 'var(--text-deep)' }}>
                            {member.full_name} leaves {company.name}: they stop working this show and
                            every other {company.name} show, and lose its paid features. Their account stays.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {staff.can_manage && (
              <form onSubmit={addMember} className="space-y-2">
                <label htmlFor="add-company-staff" className="block text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                  Add someone to {company.name}
                </label>
                <div className="flex gap-2 flex-wrap">
                  <input
                    id="add-company-staff"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email their account signs in with"
                    autoComplete="off"
                    className="border rounded px-3 py-2 text-sm flex-1 min-w-0"
                    style={inputStyle}
                  />
                  <button type="submit" disabled={busy || !email.trim()}
                    title={!email.trim() ? 'Type an email address first' : undefined}
                    className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
                    {busy ? 'Working…' : staff.adds_directly ? 'Add' : 'Ask to add'}
                  </button>
                </div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  They need a show manager or show secretary account.
                  {!staff.adds_directly && ' A GaitDesk admin approves each new member, since everyone in the company gets its paid features.'}
                </p>
              </form>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <h3 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
              Which company runs this show?
            </h3>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              This show isn&apos;t under a company yet, so only the people listed below work it. Choose the
              company that runs it and all of its managers and secretaries will work it too.
            </p>
            {staff.can_change ? (
              companyPicker()
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
                {isAdmin
                  ? 'There are no show companies yet. Create one on Show Companies first.'
                  : 'You are not in a show company yet. Message GaitDesk and they will set one up.'}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
        {notice && <p className="text-sm" style={{ color: 'var(--success-strong)' }}>{notice}</p>}
      </section>

      <GuestStaff
        showId={showId}
        companyName={company?.name ?? null}
        companyMemberIds={new Set(company?.members.map((m) => m.user_id) ?? [])}
        guests={staff.guests}
        availableManagers={availableManagers}
        availableSecretaries={availableSecretaries}
        isAdmin={isAdmin}
        onChanged={reload}
      />
    </div>
  );
}

const emptySecretaryForm = { first_name: '', last_name: '', email: '', password: '' };

/**
 * Managers and secretaries on a per-show row who are not in the show's
 * company: somebody hired for this show alone. On a show with no company yet,
 * that is everybody who works it.
 */
function GuestStaff({
  showId,
  companyName,
  companyMemberIds,
  guests,
  availableManagers,
  availableSecretaries,
  isAdmin,
  onChanged,
}: {
  showId: string;
  companyName: string | null;
  companyMemberIds: Set<string>;
  guests: ShowGuest[];
  availableManagers: Account[];
  availableSecretaries: Account[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [selected, setSelected] = useState('');
  const [newSecretary, setNewSecretary] = useState(emptySecretaryForm);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const guestIds = new Set(guests.map((g) => g.user_id));
  const pool = [...availableManagers, ...availableSecretaries]
    .filter((u) => !guestIds.has(u.id) && !companyMemberIds.has(u.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // The per-show table follows the account's role, as the endpoints require.
  const tableFor = (role: string) => (role === 'SHOW_MANAGER' ? 'managers' : 'admins');

  async function run(action: () => Promise<Response>, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setError(errorMessage(body, fallback));
        return false;
      }
      await onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const person = pool.find((u) => u.id === selected);
    if (!person) return;
    const ok = await run(
      () => fetch(`/api/shows/${showId}/${tableFor(person.role)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: person.id }),
      }),
      'They could not be added to this show.',
    );
    if (ok) { setSelected(''); setAdding(false); }
  }

  /** Create the account and put it on this show in one go (admin only): a
   *  secretary hired for the weekend needs a working login before the show. */
  async function createSecretary(e: React.FormEvent) {
    e.preventDefault();
    if (newSecretary.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const userRes = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: newSecretary.first_name.trim(),
          last_name: newSecretary.last_name.trim(),
          email: newSecretary.email.trim(),
          password: newSecretary.password,
          role: 'SHOW_SECRETARY',
        }),
      });
      const userJson = await userRes.json().catch(() => null);
      if (!userRes.ok) {
        setError(errorMessage(userJson, 'The secretary account could not be created.'));
        return;
      }
      const assignRes = await fetch(`/api/shows/${showId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userJson.id }),
      });
      if (!assignRes.ok && assignRes.status !== 409) {
        const j = await assignRes.json().catch(() => null);
        setError(errorMessage(j, 'The account was created, but putting it on this show failed.'));
        return;
      }
      setNewSecretary(emptySecretaryForm);
      setMode('pick');
      setAdding(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(guest: ShowGuest) {
    const ok = await run(
      () => fetch(`/api/shows/${showId}/${tableFor(guest.role)}/${guest.user_id}`, { method: 'DELETE' }),
      'They could not be taken off this show.',
    );
    if (ok) setConfirmRemove(null);
  }

  const inputClass = 'border rounded px-3 py-2 text-sm w-full';

  return (
    <section className="p-5 rounded-lg border space-y-3" style={card}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          {companyName ? `From outside ${companyName}` : 'Managers and secretaries'}
        </h3>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {companyName
            ? `People who work this show only, such as a secretary hired for the weekend. They aren't part of ${companyName} and don't see its other shows.`
            : 'Everyone who works this show until it has a company.'}
        </p>
      </div>

      {guests.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {companyName ? 'Nobody from outside the company.' : 'Nobody is assigned to this show.'}
        </p>
      ) : (
        <ul className="divide-y rounded border" style={listStyle}>
          {guests.map((guest) => (
            <li key={guest.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2" style={listStyle}>
              <PersonLine name={guest.full_name} email={guest.email} role={guest.role} />
              <div className="flex items-center gap-3 text-sm">
                {confirmRemove === guest.user_id ? (
                  <>
                    <button type="button" onClick={() => remove(guest)} disabled={busy}
                      className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                      Confirm remove
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)}
                      className="hover:underline" style={{ color: 'var(--muted)' }}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(guest.user_id)} disabled={busy}
                    className="hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          {companyName ? '+ Add someone for this show only' : '+ Add a manager or secretary'}
        </button>
      ) : (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex gap-2 flex-wrap">
              {(['pick', 'create'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  aria-pressed={mode === m}
                  className="text-sm rounded px-3 py-1.5 border"
                  style={{
                    borderColor: mode === m ? 'var(--text-deep)' : 'var(--border)',
                    backgroundColor: mode === m ? 'var(--warning-bg)' : 'var(--surface)',
                    color: mode === m ? 'var(--text-deep)' : 'var(--foreground)',
                    fontWeight: mode === m ? 600 : 400,
                  }}
                >
                  {m === 'pick' ? 'Pick existing' : 'Create a secretary'}
                </button>
              ))}
            </div>
          )}

          {mode === 'pick' && (
            pool.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={selected} onChange={(e) => setSelected(e.target.value)}
                  aria-label="Manager or secretary" className="border rounded px-3 py-2 text-sm flex-1 min-w-0" style={inputStyle}>
                  <option value="" disabled>Choose a manager or secretary…</option>
                  {pool.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.email}) · {ROLE_LABELS[u.role] ?? u.role}</option>
                  ))}
                </select>
                <button type="button" onClick={add} disabled={busy || !selected}
                  title={!selected ? 'Choose somebody first' : undefined}
                  className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => { setAdding(false); setSelected(''); }}
                  className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Every show manager and secretary account already works this show.
                  {isAdmin ? ' Use "Create a secretary" for someone new.' : ''}
                </p>
                <button type="button" onClick={() => setAdding(false)}
                  className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>
                  Cancel
                </button>
              </div>
            )
          )}

          {isAdmin && mode === 'create' && (
            <form onSubmit={createSecretary} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input required placeholder="First name" className={inputClass} style={inputStyle}
                  value={newSecretary.first_name}
                  onChange={(e) => setNewSecretary((f) => ({ ...f, first_name: e.target.value }))} />
                <input required placeholder="Last name" className={inputClass} style={inputStyle}
                  value={newSecretary.last_name}
                  onChange={(e) => setNewSecretary((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
              <input required type="email" placeholder="Email" autoComplete="off" className={inputClass} style={inputStyle}
                value={newSecretary.email}
                onChange={(e) => setNewSecretary((f) => ({ ...f, email: e.target.value }))} />
              <input required type="password" placeholder="Initial password (≥ 8 characters)" autoComplete="new-password"
                className={`${inputClass} font-mono`} style={inputStyle}
                value={newSecretary.password}
                onChange={(e) => setNewSecretary((f) => ({ ...f, password: e.target.value }))} />
              <div className="flex gap-2">
                <button type="submit" disabled={busy}
                  className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
                  {busy ? 'Creating…' : 'Create & add'}
                </button>
                <button type="button"
                  onClick={() => { setAdding(false); setNewSecretary(emptySecretaryForm); setError(null); }}
                  className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
    </section>
  );
}
