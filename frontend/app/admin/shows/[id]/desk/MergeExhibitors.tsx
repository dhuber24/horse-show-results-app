'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { holdingText, type MergeCandidate } from '@/lib/exhibitor-merge';
import { COLORS } from './types';

/**
 * Joining two records of one person.
 *
 * The desk has grouped same-name records under one roster entry since it was
 * built, and its note ended "If they are the same person, remove the one that
 * should not be here." Removing was all there was to offer, and it costs
 * whatever that record was holding — entries, a back number, paperwork
 * sign-offs, money taken. This is the other answer.
 *
 * Two things this screen will not do. It does not decide that two records are
 * one person: `matched_on` says why each is being *suggested*, and an email the
 * office wrote down matching the one an account was opened with is the best
 * reason this app can offer — still a reason to ask the person standing there.
 * And it does not choose which record survives silently: the direction is on
 * screen with what each one holds, because the wrong way round is recoverable
 * only by hand.
 *
 * Candidates are not scoped to this show, which is the point. The record the
 * office typed in at the August show is not on this roster and never will be;
 * the account its owner opened in November is what has to find it.
 */
export default function MergeExhibitors({
  showId,
  exhibitorId,
  exhibitorName,
  onMerged,
}: {
  showId: string;
  /** The record the panel is open on. Staff may still choose to keep the other. */
  exhibitorId: string;
  exhibitorName: string;
  onMerged: (keptExhibitorId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [chosen, setChosen] = useState<MergeCandidate | null>(null);
  /** Which record survives. Defaults to whichever holds the login. */
  const [keepId, setKeepId] = useState<string>(exhibitorId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/shows/${showId}/desk/exhibitors/${exhibitorId}/merge-candidates`,
    );
    setLoading(false);
    if (!res.ok) {
      setError('Could not look for other records.');
      setCandidates([]);
      return;
    }
    const data = await res.json().catch(() => []);
    setCandidates(Array.isArray(data) ? data : []);
  };

  const choose = (candidate: MergeCandidate) => {
    setChosen(candidate);
    setError(null);
    // The record holding the login survives by default: that is the identity
    // the person will go on using, and the other is an office record of a
    // weekend. Only a default — the radios are right there, and where both
    // hold an account the desk refuses the merge outright and sends it to an
    // admin, because choosing between somebody's two logins is not a
    // registration-counter decision.
    setKeepId(candidate.has_account ? candidate.exhibitor_id : exhibitorId);
  };

  const merge = async () => {
    if (!chosen) return;
    const removeId = keepId === exhibitorId ? chosen.exhibitor_id : exhibitorId;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/desk/exhibitors/${keepId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_exhibitor_id: removeId }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(errorMessage(body, 'Could not join those records.'));
      return;
    }
    setOpen(false);
    setChosen(null);
    setCandidates(null);
    await onMerged(keepId);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={load}
        className="text-xs hover:underline"
        style={{ color: COLORS.accent }}
      >
        Same person on file twice? Join their records
      </button>
    );
  }

  const keptName = keepId === exhibitorId ? exhibitorName : chosen?.full_name ?? '';
  const removedName = keepId === exhibitorId ? chosen?.full_name ?? '' : exhibitorName;

  return (
    <div
      className="rounded-lg border p-3 space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold" style={{ color: COLORS.text }}>
          Join {exhibitorName}&rsquo;s records
        </h4>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setChosen(null);
          }}
          className="text-xs hover:underline"
          style={{ color: COLORS.muted }}
        >
          Close
        </button>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          Looking for other records…
        </p>
      )}

      {!loading && candidates?.length === 0 && (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No other record matches this name or email address. Nothing to join.
        </p>
      )}

      {!loading && !chosen && (candidates?.length ?? 0) > 0 && (
        <>
          <p className="text-xs" style={{ color: COLORS.muted }}>
            These match on a name or an email address, which is a reason to ask rather than
            proof. Pick the one that is the same person.
          </p>
          <ul className="space-y-1.5">
            {candidates!.map((candidate) => (
              <li key={candidate.exhibitor_id}>
                <button
                  type="button"
                  onClick={() => choose(candidate)}
                  className="w-full text-left px-3 py-2 rounded border text-sm hover:bg-amber-50 transition-colors"
                  style={{ borderColor: COLORS.borderSoft, color: COLORS.text }}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{candidate.full_name}</span>
                    <span
                      className="text-xs shrink-0"
                      style={{
                        color:
                          candidate.matched_on === 'email' ? 'var(--accent)' : COLORS.muted,
                      }}
                    >
                      {candidate.matched_on === 'email' ? 'same email' : 'same name'}
                    </span>
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }}>
                    {candidate.has_account ? 'Has an account' : 'No account'}
                    {candidate.office_record ? ' · added by the office' : ''}
                    {candidate.email ? ` · ${candidate.email}` : ''}
                  </span>
                  {candidate.summary && (
                    <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }}>
                      {holdingText(candidate.summary)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {chosen && (
        <div className="space-y-2.5">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold" style={{ color: COLORS.text }}>
              Which record should everything end up on?
            </legend>
            <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="radio"
                checked={keepId === exhibitorId}
                onChange={() => setKeepId(exhibitorId)}
                className="mt-1"
              />
              <span>
                {exhibitorName}
                <span className="block text-xs" style={{ color: COLORS.muted }}>
                  The record open on this panel
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="radio"
                checked={keepId === chosen.exhibitor_id}
                onChange={() => setKeepId(chosen.exhibitor_id)}
                className="mt-1"
              />
              <span>
                {chosen.full_name}
                <span className="block text-xs" style={{ color: COLORS.muted }}>
                  {chosen.has_account ? 'Has an account' : 'No account'}
                  {chosen.summary ? ` · ${holdingText(chosen.summary)}` : ''}
                </span>
              </span>
            </label>
          </fieldset>

          <div
            className="rounded border p-2.5 text-xs"
            style={{
              borderColor: 'var(--warning-border)',
              backgroundColor: 'var(--warning-bg)',
              color: 'var(--text-deep)',
            }}
          >
            Everything on <strong>{removedName}</strong> — classes, back numbers, horses,
            memberships, signed waivers and payments — moves onto{' '}
            <strong>{keptName}</strong>, and that record is then removed. Where both hold the
            same thing, {keptName}&rsquo;s answer is kept. This cannot be undone in one press.
          </div>

          {error && (
            <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={merge}
              disabled={saving}
              className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: COLORS.accent }}
            >
              {saving ? 'Joining…' : `Join into ${keptName}`}
            </button>
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Pick a different record
            </button>
          </div>
        </div>
      )}

      {error && !chosen && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

