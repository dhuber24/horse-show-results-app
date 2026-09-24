'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import type { ShowCompany } from '@/lib/show-companies';
import FeatureToggle from '../FeatureToggle';

export interface StaffAccount {
  id: string;
  full_name: string;
  last_name: string;
  first_name: string;
  email: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
};

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const sectionStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function accountsText(count: number): string {
  return count === 1 ? '1 account' : `${count} accounts`;
}

export default function CompanyDetail({
  initialCompany,
  staff,
}: {
  initialCompany: ShowCompany;
  staff: StaffAccount[];
}) {
  const router = useRouter();
  const [company, setCompany] = useState<ShowCompany>(initialCompany);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pick, setPick] = useState('');
  const [name, setName] = useState(initialCompany.name);
  const [notes, setNotes] = useState(initialCompany.notes ?? '');

  const memberIds = useMemo(() => new Set(company.members.map((m) => m.user_id)), [company.members]);
  const offered = useMemo(
    () =>
      staff
        .filter((s) => !memberIds.has(s.id))
        .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)),
    [staff, memberIds],
  );
  const detailsDirty = name.trim() !== company.name || (notes.trim() || null) !== (company.notes ?? null);

  /** Every write answers with the whole company; redraw from that. */
  async function send(key: string, url: string, init: RequestInit, fallback: string): Promise<ShowCompany | null> {
    setBusy(key);
    setError(null);
    const res = await fetch(url, init).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(null);
    if (!res?.ok) {
      setError(errorMessage(body, fallback));
      return null;
    }
    setCompany(body as ShowCompany);
    return body as ShowCompany;
  }

  const base = `/api/show-companies/${company.id}`;

  const addMember = async () => {
    if (!pick) return;
    if (
      await send(
        'member:add',
        `${base}/members`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: pick }) },
        'The account could not be added.',
      )
    ) {
      setPick('');
    }
  };

  const removeMember = (userId: string) =>
    send(`member:${userId}`, `${base}/members/${userId}`, { method: 'DELETE' }, 'The account could not be removed.');

  // Approving is adding the member; the backend clears the request with it.
  const approveRequest = (userId: string) =>
    send(
      `request:${userId}`,
      `${base}/members`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) },
      'The account could not be added.',
    );

  const declineRequest = (userId: string) =>
    send(`request:${userId}`, `${base}/join-requests/${userId}`, { method: 'DELETE' }, 'The request could not be declined.');

  const owner = company.owner_user_id
    ? company.members.find((m) => m.user_id === company.owner_user_id)
    : undefined;

  const saveDetails = async () => {
    const saved = await send(
      'details',
      base,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), notes: notes.trim() || null }),
      },
      'The company could not be saved.',
    );
    if (saved) {
      // The backend tidies the name (inner spaces closed up), so the boxes take
      // back what was stored -- otherwise the form reads as still unsaved.
      setName(saved.name);
      setNotes(saved.notes ?? '');
      router.refresh();
    }
  };

  const deleteCompany = async () => {
    setBusy('delete');
    setError(null);
    const res = await fetch(base, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      setError(errorMessage(res ? await res.json().catch(() => null) : null, 'The company could not be deleted.'));
      return;
    }
    router.push('/admin/companies');
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="text-sm rounded border p-3"
          style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
        >
          {error}
        </p>
      )}

      {company.owner_user_id && (
        <p
          className="text-sm rounded border p-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
        >
          <span className="font-semibold">Independent.</span> This is{' '}
          {owner ? `${owner.full_name}'s` : 'one person’s'} own company, made with their account because they
          work for no club or firm. It follows their name until you give it another one.
        </p>
      )}

      {company.join_requests.length > 0 && (
        <section
          className="p-5 rounded-lg border space-y-3"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
              Asked to join ({company.join_requests.length})
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-deep)' }}>
              They typed this company&apos;s name when they signed up. They aren&apos;t members until you add
              them, because members get this company&apos;s paid features. Until then they have a company of
              their own.
            </p>
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--warning-border)' }}>
            {company.join_requests.map((request) => (
              <li key={request.user_id} className="py-2 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/admin/users/${request.user_id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {request.full_name}
                  </Link>
                  <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {request.email} · {ROLE_LABEL[request.role] ?? request.role}
                    {request.requested_at ? ` · asked ${formatDate(request.requested_at)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => approveRequest(request.user_id)}
                    disabled={busy !== null}
                    title={busy !== null ? 'Waiting for the last change to save' : undefined}
                    className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
                  >
                    {busy === `request:${request.user_id}` ? 'Saving…' : 'Add to company'}
                  </button>
                  <button
                    onClick={() => declineRequest(request.user_id)}
                    disabled={busy !== null}
                    title={busy !== null ? 'Waiting for the last change to save' : undefined}
                    className="text-sm font-medium hover:underline disabled:opacity-50"
                    style={{ color: 'var(--muted)' }}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="p-5 rounded-lg border space-y-3" style={sectionStyle}>
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>Paid features</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            A feature switched on reaches every account below, straight away. Switching it off keeps
            their work, which comes back when it is switched on again. GaitDesk admins always have every
            feature.
          </p>
        </div>
        <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {company.features.map((feature) => (
            <li key={feature.key} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                  {feature.label}
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted)' }}>
                    {feature.plan}
                  </span>
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{feature.description}</p>
                {feature.enabled && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>
                    On for {accountsText(company.members.length)} since {formatDate(feature.enabled_at)}
                    {feature.enabled_by_name ? ` · turned on by ${feature.enabled_by_name}` : ''}
                  </p>
                )}
              </div>
              <FeatureToggle
                companyId={company.id}
                companyName={company.name}
                feature={feature}
                onChange={setCompany}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="p-5 rounded-lg border space-y-3" style={sectionStyle}>
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            Accounts ({company.members.length})
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            The staff who work for this company. An account can be in more than one company, and gets
            every feature any of them has.
          </p>
        </div>
        {company.members.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Nobody yet — a feature turned on here reaches nobody until an account is added.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {company.members.map((member) => (
              <li key={member.user_id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/users/${member.user_id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {member.full_name}
                  </Link>
                  <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {member.email} · {ROLE_LABEL[member.role] ?? member.role}
                  </p>
                </div>
                {member.user_id === company.owner_user_id ? (
                  // Their own company is where they are when they work for
                  // nobody; it goes by itself once they join an organization.
                  <span
                    className="shrink-0 text-xs"
                    style={{ color: 'var(--muted)' }}
                    title="Their own company goes by itself once they are added to the company they work for."
                  >
                    Their own company
                  </span>
                ) : (
                  <button
                    onClick={() => removeMember(member.user_id)}
                    disabled={busy !== null}
                    title={busy !== null ? 'Waiting for the last change to save' : undefined}
                    className="shrink-0 text-sm font-medium hover:underline disabled:opacity-50"
                    style={{ color: 'var(--error)' }}
                  >
                    {busy === `member:${member.user_id}` ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <label htmlFor="company-add-member" className="sr-only">Account to add</label>
          <select
            id="company-add-member"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="min-w-0 flex-1 border rounded px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="">
              {offered.length === 0 ? 'No show managers or secretaries left to add' : 'Add a show manager or secretary…'}
            </option>
            {offered.map((account) => (
              <option key={account.id} value={account.id}>
                {account.full_name} — {account.email} ({ROLE_LABEL[account.role] ?? account.role})
              </option>
            ))}
          </select>
          <button
            onClick={addMember}
            disabled={!pick || busy !== null}
            title={!pick ? 'Pick an account first' : busy !== null ? 'Waiting for the last change to save' : undefined}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
          >
            {busy === 'member:add' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </section>

      <section className="p-5 rounded-lg border space-y-3" style={sectionStyle}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>Details</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="company-name" className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
            Name *
          </label>
          <input
            id="company-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="company-notes" className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>
            Notes
          </label>
          <textarea
            id="company-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Billing arrangement, main contact…"
            className="border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Only GaitDesk admins see these. GaitDesk doesn&apos;t take payment yet, so this is where the
            arrangement is written down.
          </span>
        </div>
        <button
          onClick={saveDetails}
          disabled={!detailsDirty || !name.trim() || busy !== null}
          title={
            !name.trim()
              ? 'A company needs a name'
              : !detailsDirty
                ? 'Nothing has changed'
                : busy !== null
                  ? 'Waiting for the last change to save'
                  : undefined
          }
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
        >
          {busy === 'details' ? 'Saving…' : 'Save'}
        </button>
      </section>

      <section className="p-5 rounded-lg border space-y-3" style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--error-strong)' }}>Delete this company</h2>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
            title={busy !== null ? 'Waiting for the last change to save' : undefined}
            className="px-4 py-2 rounded border text-sm font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--error-border)', color: 'var(--error-strong)', backgroundColor: 'var(--surface)' }}
          >
            Delete company
          </button>
        ) : (
          <div className="space-y-2 text-sm" style={{ color: 'var(--text-deep)' }}>
            <p>
              Delete {company.name}? Its {accountsText(company.members.length)} keep their logins and their
              shows, but lose every feature they had only through this company.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={deleteCompany}
                disabled={busy !== null}
                title={busy !== null ? 'Waiting for the last change to save' : undefined}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--error)', color: 'var(--surface)' }}
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
