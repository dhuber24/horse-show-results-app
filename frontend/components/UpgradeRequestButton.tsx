'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import {
  defaultUpgradeCompany,
  planFor,
  upgradeRequestFor,
  type MyFeatures,
  type UpgradeRequest,
} from '@/lib/show-companies';

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Ask GaitDesk for a paid feature, from the door it is locked behind
 * (migration 144).
 *
 * One press, no form: GaitDesk already knows who is asking and has their
 * email, and every question between a locked button and a request is a reason
 * not to send it. The request is **the company's**, so a colleague's earlier
 * press shows here as already asked rather than offering the button twice —
 * and somebody who works for several companies chooses which one is asking,
 * the club ahead of their own account by default.
 *
 * Renders nothing for somebody in no company: there is nothing to upgrade,
 * and the locked text beside it already says what to do first.
 */
export default function UpgradeRequestButton({ mine, feature }: { mine: MyFeatures; feature: string }) {
  const plan = planFor(mine, feature);
  const [request, setRequest] = useState<UpgradeRequest | null>(() => upgradeRequestFor(mine, feature));
  const [companyId, setCompanyId] = useState<string>(() => defaultUpgradeCompany(mine)?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mine.companies.length === 0) return null;

  if (request) {
    const when = formatDate(request.requested_at);
    // GaitDesk answers whoever pressed the button, so a colleague's request
    // names them as the person to expect the call -- not the viewer.
    const followUp = request.requested_by_me
      ? 'Your request is being reviewed, and someone from the GaitDesk team will contact you soon.'
      : request.requested_by_name
        ? `It's being reviewed, and someone from the GaitDesk team will contact ${request.requested_by_name} soon.`
        : 'The request is being reviewed, and someone from the GaitDesk team will be in contact soon.';
    return (
      <p role="status" className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
        <CheckIcon />
        <span>
          {/* The date is formatted in the viewer's time zone and the server's
              is UTC, so the two renders can disagree about which day it was. */}
          {request.requested_by_me || !request.requested_by_name ? (
            <>
              <span className="font-semibold" suppressHydrationWarning>
                Upgrade requested{when ? ` ${when}` : ''}.
              </span>{' '}
            </>
          ) : (
            <>
              <span className="font-semibold" suppressHydrationWarning>
                {request.requested_by_name} asked for {plan} for {request.company_name}
                {when ? ` on ${when}` : ''}.
              </span>{' '}
            </>
          )}
          <span style={{ color: 'var(--muted)' }}>{followUp}</span>
        </span>
      </p>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/users/me/upgrade-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, company_id: companyId || null }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setError(errorMessage(body, 'The request could not be sent. Try again in a moment.'));
      return;
    }
    setRequest(body as UpgradeRequest);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {mine.companies.length > 1 && (
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
            <span className="shrink-0">For</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="min-w-0 flex-1 border rounded-lg px-3 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
            >
              {mine.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.personal ? 'My own account' : c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={send}
          disabled={busy}
          title={busy ? 'Sending…' : `Ask GaitDesk to set up ${plan}`}
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-lg text-sm font-semibold disabled:opacity-60 disabled:cursor-wait"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          <SparkIcon />
          {busy ? 'Sending…' : `Request upgrade to ${plan}`}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }}>
      <path fill="currentColor" d="M8.1 13.3 4.8 10l-1.1 1.1 4.4 4.4 8.2-8.2-1.1-1.1z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 shrink-0">
      <path fill="currentColor" d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6z" />
    </svg>
  );
}
