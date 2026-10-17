'use client';

import { useState } from 'react';
import ChoosePlanPanel from '@/components/ChoosePlanPanel';
import SelfCancelPolicy from '@/components/SelfCancelPolicy';
import { errorMessage } from '@/lib/api-error';
import { formatDay, formatRate, type PlanInfo, type PlanKey } from '@/lib/show-companies';

/** One company the caller works for, as `GET /my-company` returns it. No
 *  notes and no add-on switches: those are GaitDesk's. */
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
   *  somebody here asked for them before companies added people themselves. */
  source: 'signup' | 'company';
  vouched_by_name: string | null;
  vouched_at: string | null;
  vouched_by_me: boolean;
};

/** A scribe or gate steward on the company's crew (migration 169). */
export type CrewMember = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  added_at: string | null;
};

export type CompanyInvite = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  expires_at: string;
  /** Only on the response that made it. */
  accept_url?: string | null;
};

export type MyPlan = {
  plan: PlanKey;
  plan_label: string;
  effective_plan: PlanKey;
  effective_plan_label: string;
  rate_cents: number;
  sets_up_shows: boolean;
  pro_plus: { starts_on: string; ends_on: string; renewal_due: boolean } | null;
  pro_plus_requested_at: string | null;
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
  /** Migration 169. */
  plan?: MyPlan | null;
  crew?: CrewMember[];
  invites?: CompanyInvite[];
};

const ROLE_LABELS: Record<string, string> = {
  SHOW_MANAGER: 'Show Manager',
  SHOW_SECRETARY: 'Show Secretary',
  SCRIBE: 'Scribe',
  GATE_STEWARD: 'Gate Steward',
};

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const primaryButton = { backgroundColor: 'var(--accent)', color: 'var(--surface)' } as const;
const inputClass = 'border rounded px-3 py-2 text-sm min-w-0';

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
      {children}
    </span>
  );
}

/** Where the company stands: its plan, a Pro+ year and its end, and the way to change. */
function PlanBlock({
  company,
  plans,
  onChange,
}: {
  company: MyCompany;
  plans: PlanInfo[];
  onChange: (next: MyCompany) => void;
}) {
  const plan = company.plan;
  // A company on Free has nothing else to do here first, so the chooser is open.
  const [choosing, setChoosing] = useState(plan?.plan === 'free' && !plan?.pro_plus);
  if (!plan) return null;
  const year = plan.pro_plus;
  const afterYear = plans.find((p) => p.key === plan.plan);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Plan: {plan.effective_plan_label}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {year ? (
              <>
                Unlimited shows and exhibitors through {formatDay(year.ends_on)}. After that,{' '}
                {plan.plan === 'free'
                  ? 'GaitDesk Free — no new shows until you pick a plan.'
                  : `${plan.plan_label} at ${formatRate(plan.rate_cents)} per exhibitor, billed after each show.`}
              </>
            ) : plan.sets_up_shows ? (
              `${formatRate(plan.rate_cents)} per exhibitor registered to each show, billed after the show.`
            ) : (
              'Build your team for free. Choose Basic or Pro to set up a show — nothing is charged until after it.'
            )}
          </p>
        </div>
        {!choosing && (
          <button type="button" onClick={() => setChoosing(true)} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
            {year ? `Change what follows Pro+` : 'Change plan'}
          </button>
        )}
      </div>

      {year?.renewal_due && (
        <p
          role="status"
          className="text-sm rounded border p-3"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
        >
          <span className="font-semibold">Your Pro+ year ends {formatDay(year.ends_on)}.</span> Renew with GaitDesk to
          keep unlimited shows. Otherwise {company.name} moves to {afterYear?.label ?? plan.plan_label} the day after
          {afterYear && afterYear.rate_cents > 0 ? `, at ${formatRate(afterYear.rate_cents)} per exhibitor` : ''}.
        </p>
      )}

      {choosing && (
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--background)' }}>
          <ChoosePlanPanel
            heading={plan.plan === 'free' ? 'Choose a plan to set up shows' : year ? 'The plan after your Pro+ year' : 'Change plan'}
            companies={[{ id: company.id, name: company.name, personal: company.personal }]}
            plans={year ? plans.filter((p) => p.key !== 'pro_plus') : plans}
            current={plan.plan === 'free' ? undefined : plan.plan}
            proPlusRequested={Boolean(plan.pro_plus_requested_at)}
            onChosen={(body) => {
              onChange(body as MyCompany);
              setChoosing(false);
            }}
          />
          {plan.plan !== 'free' && (
            <button type="button" onClick={() => setChoosing(false)} className="mt-3 text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Keep {plan.plan_label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Add by an existing account's email, or invite somebody who has none. */
function AddPeople({
  company,
  kind,
  busy,
  onAdd,
  onInvite,
}: {
  company: MyCompany;
  kind: 'staff' | 'crew';
  busy: boolean;
  onAdd: (email: string) => Promise<boolean>;
  onInvite: (form: { first_name: string; last_name: string; email: string; role: string }) => Promise<boolean>;
}) {
  const roles = kind === 'staff' ? ['SHOW_SECRETARY', 'SHOW_MANAGER'] : ['SCRIBE', 'GATE_STEWARD'];
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', role: roles[0] });
  const who = kind === 'staff' ? 'show manager or secretary' : 'scribe or gate steward';
  const idBase = `${kind}-${company.id}`;

  return (
    <div className="space-y-2">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (email.trim() && (await onAdd(email.trim()))) setEmail('');
        }}
        className="flex gap-2 flex-wrap"
      >
        <label htmlFor={`${idBase}-email`} className="sr-only">
          Email of their {who} account
        </label>
        <input
          id={`${idBase}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`Email of their ${who} account`}
          autoComplete="off"
          className={`${inputClass} flex-1`}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          title={!email.trim() ? 'Type an email address first' : `Adds them to ${company.name}`}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={primaryButton}
        >
          {busy ? 'Working…' : 'Add'}
        </button>
      </form>
      {!inviting ? (
        <button type="button" onClick={() => setInviting(true)} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          + Invite somebody without an account
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onInvite(form)) {
              setForm({ first_name: '', last_name: '', email: '', role: roles[0] });
              setInviting(false);
            }
          }}
          className="grid sm:grid-cols-2 gap-2 rounded border p-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <input required placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className={inputClass} style={inputStyle} aria-label="First name" />
          <input required placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className={inputClass} style={inputStyle} aria-label="Last name" />
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} style={inputStyle} aria-label="Email" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass} style={inputStyle} aria-label="Role">
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <div className="sm:col-span-2 flex gap-3 items-center">
            <button type="submit" disabled={busy} title={busy ? 'Working…' : 'Makes an invite link to send them'} className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50" style={primaryButton}>
              {busy ? 'Working…' : 'Create invite'}
            </button>
            <button type="button" onClick={() => setInviting(false)} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function CompanySection({
  company,
  plans,
  onChange,
  onRemoved,
}: {
  company: MyCompany;
  plans: PlanInfo[];
  onChange: (next: MyCompany) => void;
  /** A removal answers with every company the caller is still in. */
  onRemoved: (next: MyCompany[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  const base = `/api/my-company/${company.id}`;

  const addStaff = async (email: string) => {
    const body = await send(`${base}/members`, { method: 'POST', body: JSON.stringify({ email }) }, 'They could not be added.');
    if (!body) return false;
    onChange(body as MyCompany);
    setNotice(`Added ${email} to ${company.name}.`);
    return true;
  };

  const addCrew = async (email: string) => {
    const body = await send(`${base}/crew`, { method: 'POST', body: JSON.stringify({ email }) }, 'They could not be added.');
    if (!body) return false;
    onChange(body as MyCompany);
    setNotice(`Added ${email} to the crew. Assign them to a show from its setup, Step 1.`);
    return true;
  };

  const invite = async (form: { first_name: string; last_name: string; email: string; role: string }) => {
    const body = (await send(`${base}/invites`, { method: 'POST', body: JSON.stringify(form) }, 'The invite could not be made.')) as CompanyInvite | null;
    if (!body) return false;
    onChange({ ...company, invites: [...(company.invites ?? []), body] });
    if (body.accept_url) {
      setLastInvite({ name: `${body.first_name} ${body.last_name}`, url: body.accept_url });
      setCopied(false);
    }
    return true;
  };

  const cancelInvite = async (inv: CompanyInvite) => {
    const body = await send(`${base}/invites/${inv.id}`, { method: 'DELETE' }, 'The invite could not be cancelled.');
    if (body) onChange(body as MyCompany);
  };

  const remove = async (member: StaffMember) => {
    const body = await send(
      `${base}/members/${member.user_id}`,
      { method: 'DELETE' },
      member.is_me ? 'You could not leave the company.' : 'That account could not be removed.',
    );
    setConfirmRemove(null);
    if (body) onRemoved(body as MyCompany[]);
  };

  const removeCrew = async (person: CrewMember) => {
    const body = await send(`${base}/crew/${person.user_id}`, { method: 'DELETE' }, 'They could not be taken off the crew.');
    setConfirmRemove(null);
    if (body) onChange(body as MyCompany);
  };

  const answer = async (request: StaffRequest, approve: boolean) => {
    const body = await send(
      `${base}/join-requests/${request.user_id}`,
      { method: approve ? 'POST' : 'DELETE' },
      approve ? 'The request could not be approved.' : 'The request could not be declined.',
    );
    if (body) {
      onChange(body as MyCompany);
      setNotice(approve ? `${request.full_name} is now on ${company.name}'s staff.` : `Declined ${request.full_name}.`);
    }
  };

  // The company's own policy, written outright.
  const savePolicy = async (daysBefore: number): Promise<string | null> => {
    const res = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ self_cancel_days_before: daysBefore }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) return errorMessage(body, 'The cancellation policy could not be saved.');
    onChange(body as MyCompany);
    return null;
  };

  const crew = company.crew ?? [];
  const invites = company.invites ?? [];

  return (
    <section className="border rounded-lg p-4 space-y-6" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{company.name}</h2>
          {company.personal && <Badge>Your own company</Badge>}
        </div>
        {company.features.length > 0 && (
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Everyone here can use {company.features.map((f) => f.label).join(', ')}.
          </p>
        )}
      </div>

      <PlanBlock company={company} plans={plans} onChange={onChange} />

      {company.join_requests.length > 0 && (
        <div className="space-y-2 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Asking to join ({company.join_requests.length})
          </h3>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            They typed this company&apos;s name when they signed up. Approve only people who work for you — they
            join straight away and work every show the company runs.
          </p>
          <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
            {company.join_requests.map((request) => (
              <li key={request.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>{request.full_name}</div>
                  <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
                    {request.email} · {ROLE_LABELS[request.role] ?? request.role}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <button type="button" onClick={() => answer(request, true)} disabled={busy}
                    title={busy ? 'Working…' : `Adds them to ${company.name}`}
                    className="px-3 py-1.5 rounded font-medium disabled:opacity-50" style={primaryButton}>
                    Approve
                  </button>
                  <button type="button" onClick={() => answer(request, false)} disabled={busy}
                    title={busy ? 'Working…' : 'Turns the request down'}
                    className="hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Staff ({company.members.length})
        </h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Show managers and secretaries. Everyone here works every show the company runs.
        </p>
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
        {confirmRemove && company.members.some((m) => m.user_id === confirmRemove) && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {company.members.find((m) => m.user_id === confirmRemove)?.is_me
              ? 'You will stop working the shows this company runs.'
              : 'They stop working the shows this company runs. Their account is not affected.'}
          </p>
        )}
        <AddPeople company={company} kind="staff" busy={busy} onAdd={addStaff} onInvite={invite} />
      </div>

      <div className="space-y-2 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Crew ({crew.length})
        </h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Your scribes and gate stewards. They work only the shows you assign them to, from each show&apos;s setup,
          Step 1.
        </p>
        {crew.length > 0 && (
          <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
            {crew.map((person) => (
              <li key={person.user_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>{person.full_name}</div>
                  <div className="text-xs break-all" style={{ color: 'var(--muted)' }}>
                    {person.email} · {ROLE_LABELS[person.role] ?? person.role}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {confirmRemove === person.user_id ? (
                    <>
                      <button type="button" onClick={() => removeCrew(person)} disabled={busy}
                        className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                        Confirm remove
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmRemove(person.user_id)} disabled={busy}
                      title={busy ? 'Working…' : undefined}
                      className="hover:underline disabled:opacity-40" style={{ color: 'var(--error)' }}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {confirmRemove && crew.some((c) => c.user_id === confirmRemove) && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            They come off every show of yours that hasn&apos;t finished. Finished shows keep the record of who worked them.
          </p>
        )}
        <AddPeople company={company} kind="crew" busy={busy} onAdd={addCrew} onInvite={invite} />
      </div>

      {(invites.length > 0 || lastInvite) && (
        <div className="space-y-2 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Invites waiting ({invites.length})
          </h3>
          {lastInvite && (
            <div className="rounded border p-3 text-sm space-y-2" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}>
              <p style={{ color: 'var(--text-deep)' }}>
                Send {lastInvite.name} this link. It sets up their account and expires in 14 days.
              </p>
              <div className="flex gap-2 flex-wrap">
                <input readOnly value={lastInvite.url} className={`${inputClass} flex-1 font-mono text-xs`} style={inputStyle} aria-label="Invite link" />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(lastInvite.url).then(() => setCopied(true)).catch(() => undefined)}
                  className="px-3 py-1.5 rounded text-sm font-medium"
                  style={primaryButton}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="divide-y rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {inv.first_name} {inv.last_name}
                    </div>
                    <div className="text-xs break-all" style={{ color: 'var(--muted)' }} suppressHydrationWarning>
                      {inv.email} · {ROLE_LABELS[inv.role] ?? inv.role} · expires {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <button type="button" onClick={() => cancelInvite(inv)} disabled={busy}
                    title={busy ? 'Working…' : 'The link stops working'}
                    className="text-sm hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
      {notice && <p className="text-sm" style={{ color: 'var(--success-strong)' }}>{notice}</p>}

      {/* Below the people, since a policy is set once and left. */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <SelfCancelPolicy value={company.self_cancel_days_before ?? 0} onSave={savePolicy} />
      </div>
    </section>
  );
}

/**
 * My Company — a show manager or secretary running their show company
 * (`routers/my_company.py`): its plan, its staff, its crew of scribes and gate
 * stewards, and its invites. Since migration 169 the company adds people
 * itself and picks its own plan; a GaitDesk admin starts a Pro+ year.
 */
export default function MyCompanyStaff({ initialCompanies, plans }: { initialCompanies: MyCompany[]; plans: PlanInfo[] }) {
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
          plans={plans}
          onChange={(next) => setCompanies((list) => list.map((c) => (c.id === next.id ? next : c)))}
          onRemoved={setCompanies}
        />
      ))}
    </div>
  );
}
