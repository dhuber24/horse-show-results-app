'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { holdingText, type MergeCandidate, type MergeConflict } from '@/lib/exhibitor-merge';
import { COLORS, exhibitorNumbers } from './types';
import type { DeskExhibitor } from './types';

type Choice = 'kept' | 'other';

/**
 * Joining another record of the same person onto the one the panel is open on.
 *
 * The desk has grouped same-name records under one roster entry since it was
 * built, and its note ended "If they are the same person, remove the one that
 * should not be here." Removing was all there was to offer, and it costs
 * whatever that record was holding — entries, a back number, paperwork
 * sign-offs, money taken. This is the other answer.
 *
 * It does not decide that two records are one person: `matched_on` says why
 * each is being *suggested*. And it never picks between two different answers
 * on its own — two phone numbers, two back numbers at one show, two membership
 * numbers. Pressing Merge first asks the backend where the records disagree
 * (`merge-conflicts`) and the office picks the right answer to each; the merge
 * is refused until every one is picked. A blank on this record is filled from
 * the other, and nothing this record already holds is replaced unless the
 * office chose the other answer.
 *
 * Only the matches are listed — never the record being viewed, which the
 * backend leaves out by id, and this screen again — and each merges into the
 * record being viewed. Two records of one person usually share a name, so each
 * row says what tells it apart: an account or not, on this show or not, the
 * back number, what it holds. The record being viewed is described the same
 * way at the top, so the two can be compared.
 *
 * Merging into the viewed record cannot lose a login: one on the match moves
 * onto this record (`merge_exhibitors`), and where both records sign in the
 * backend refuses and says so.
 *
 * Candidates are not scoped to this show, which is the point. The record the
 * office typed in at the August show is not on this roster and never will be;
 * the account its owner opened in November is what has to find it.
 *
 * It looks as soon as somebody's panel opens and says nothing unless it finds
 * a match. One read per panel opened, not per desk load — the roster stays one
 * read.
 */
export default function MergeExhibitors({
  showId,
  exhibitor,
  onRoster,
  onMerged,
}: {
  showId: string;
  /** The record the panel is open on, and the one every merge here keeps. */
  exhibitor: DeskExhibitor;
  /** Every record on this show's roster, with its back number. */
  onRoster: Map<string, number | null>;
  onMerged: (keptExhibitorId: string) => Promise<void>;
}) {
  const exhibitorId = exhibitor.exhibitor_id;
  const exhibitorName = exhibitor.exhibitor_name;

  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  /** The match whose merge is being confirmed. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** Where that match and this record disagree; null while being looked up. */
  const [conflicts, setConflicts] = useState<MergeConflict[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  /** The comparison was refused — the merge would be too. */
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `/api/shows/${showId}/desk/exhibitors/${exhibitorId}/merge-candidates`,
        { signal },
      );
      // A lookup that fails says nothing: the message is a prompt, not a
      // control the desk relies on.
      const data = res.ok ? await res.json().catch(() => []) : [];
      const found: MergeCandidate[] = Array.isArray(data) ? data : [];
      if (!signal?.aborted) setCandidates(found.filter((c) => c.exhibitor_id !== exhibitorId));
    } catch {
      if (!signal?.aborted) setCandidates([]);
    }
  }, [showId, exhibitorId]);

  useEffect(() => {
    const controller = new AbortController();
    setCandidates(null);
    setOpen(false);
    setConfirmingId(null);
    setError(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const closeConfirm = () => {
    setConfirmingId(null);
    setConflicts(null);
    setChoices({});
    setRefused(false);
    setError(null);
  };

  const startConfirm = async (candidate: MergeCandidate) => {
    setConfirmingId(candidate.exhibitor_id);
    setConflicts(null);
    setChoices({});
    setRefused(false);
    setError(null);
    const res = await fetch(
      `/api/shows/${showId}/desk/exhibitors/${exhibitorId}/merge-conflicts?other=${candidate.exhibitor_id}`,
      { cache: 'no-store' },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Refused before anything is picked — two logins, say — rather than
      // after the office has worked through the list.
      setError(errorMessage(body, `Could not compare ${candidate.full_name}’s records.`));
      setConflicts([]);
      setRefused(true);
      return;
    }
    setConflicts(Array.isArray(body) ? body : []);
  };

  const merge = async (candidate: MergeCandidate) => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/desk/exhibitors/${exhibitorId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_exhibitor_id: candidate.exhibitor_id, choices }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Somebody changed one of the records since the list was read: ask
      // about what disagrees now.
      const fresh = body?.detail?.code === 'MERGE_CONFLICTS' ? body.detail.conflicts : null;
      if (Array.isArray(fresh)) setConflicts(fresh);
      setError(errorMessage(body, `Could not merge ${candidate.full_name} into this record.`));
      return;
    }
    closeConfirm();
    await onMerged(exhibitorId);
    // There may be another match still, or none left. Look again either way;
    // with none, the whole control disappears.
    await load();
  };

  // Nothing found, or still looking: say nothing.
  if (!candidates || candidates.length === 0) return null;

  if (!open) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-deep)' }}>
        Another exhibitor that matches this one was found.{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium underline decoration-dotted hover:decoration-solid"
          style={{ color: COLORS.accent }}
        >
          Review and merge them now?
        </button>
      </p>
    );
  }

  const viewingNumbers = exhibitorNumbers(exhibitor);
  const viewingFacts = [
    exhibitor.contact?.email_source === 'account' ? 'Has an account' : 'No account',
    'On this show',
    viewingNumbers.length > 0 ? `Back #${viewingNumbers.join(', #')}` : 'No back number',
    `${exhibitor.entries.length} class${exhibitor.entries.length === 1 ? '' : 'es'}`,
    exhibitor.contact?.email ?? null,
  ].filter(Boolean);

  return (
    <div
      className="rounded-lg border p-3 space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold" style={{ color: COLORS.text }}>
          Possible matches for {exhibitorName}
        </h4>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            closeConfirm();
          }}
          className="text-xs hover:underline"
          style={{ color: COLORS.muted }}
        >
          Close
        </button>
      </div>

      <p className="text-xs" style={{ color: COLORS.muted }}>
        <span className="font-semibold" style={{ color: COLORS.text }}>
          The record you are viewing:
        </span>{' '}
        {viewingFacts.join(' · ')}
      </p>

      <ul className="space-y-2">
        {candidates.map((candidate) => {
          const confirming = confirmingId === candidate.exhibitor_id;
          const here = onRoster.has(candidate.exhibitor_id);
          const number = onRoster.get(candidate.exhibitor_id);
          const allPicked = (conflicts ?? []).every((c) => choices[c.key]);
          return (
            <li
              key={candidate.exhibitor_id}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: COLORS.borderSoft, color: COLORS.text }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{candidate.full_name}</span>
                    <span
                      className="text-xs"
                      style={{
                        color: candidate.matched_on === 'email' ? 'var(--accent)' : COLORS.muted,
                      }}
                    >
                      {candidate.matched_on === 'email' ? 'same email' : 'same name'}
                    </span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                    {candidate.has_account ? 'Has an account' : 'No account'}
                    {candidate.office_record ? ' · added by the office' : ''}
                    {here
                      ? ` · On this show${number != null ? ` · Back #${number}` : ''}`
                      : ' · Not on this show'}
                    {candidate.email ? ` · ${candidate.email}` : ''}
                  </p>
                  {candidate.summary && (
                    <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                      {holdingText(candidate.summary)}
                    </p>
                  )}
                </div>
                {!confirming && (
                  <button
                    type="button"
                    onClick={() => void startConfirm(candidate)}
                    disabled={saving}
                    className="shrink-0 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: COLORS.accent }}
                  >
                    Merge into {exhibitorName}
                  </button>
                )}
              </div>

              {confirming && (
                <div className="mt-2 space-y-2">
                  <div
                    className="rounded border p-2.5 text-xs font-medium"
                    style={{
                      borderColor: 'var(--warning-border)',
                      backgroundColor: 'var(--warning-bg)',
                      color: 'var(--text-deep)',
                    }}
                  >
                    Merging these records cannot be undone - please verify these records are in
                    fact the same person before proceeding
                  </div>

                  {conflicts === null && (
                    <p className="text-xs" style={{ color: COLORS.muted }}>
                      Comparing the two records…
                    </p>
                  )}

                  {conflicts !== null && conflicts.length > 0 && (
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-semibold mb-1" style={{ color: COLORS.text }}>
                        Both records have an answer for these. Pick the right one for each:
                      </legend>
                      {conflicts.map((conflict) => (
                        <div
                          key={conflict.key}
                          className="rounded border px-2.5 py-2"
                          style={{ borderColor: COLORS.borderSoft }}
                        >
                          <p className="text-xs font-semibold" style={{ color: COLORS.text }}>
                            {conflict.label}
                            {conflict.context && (
                              <span className="font-normal" style={{ color: COLORS.muted }}>
                                {' '}— {conflict.context}
                              </span>
                            )}
                          </p>
                          {(['kept', 'other'] as Choice[]).map((side) => (
                            <label
                              key={side}
                              className="flex items-start gap-2 text-sm mt-1"
                              style={{ color: COLORS.text }}
                            >
                              <input
                                type="radio"
                                name={`merge-${candidate.exhibitor_id}-${conflict.key}`}
                                checked={choices[conflict.key] === side}
                                onChange={() =>
                                  setChoices((prev) => ({ ...prev, [conflict.key]: side }))
                                }
                                className="mt-1"
                              />
                              <span>
                                {side === 'kept' ? conflict.kept_value : conflict.other_value}
                                <span className="block text-xs" style={{ color: COLORS.muted }}>
                                  {side === 'kept' ? 'On the record you are viewing' : 'On the matching record'}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </fieldset>
                  )}

                  {error && (
                    <p className="text-sm" role="alert" style={{ color: 'var(--error-strong)' }}>
                      {error}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void merge(candidate)}
                      disabled={saving || refused || conflicts === null || !allPicked}
                      title={
                        conflicts !== null && !allPicked
                          ? 'Pick the right answer for each field above first'
                          : undefined
                      }
                      className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: COLORS.accent }}
                    >
                      {saving ? 'Merging…' : 'Yes, merge them'}
                    </button>
                    <button
                      type="button"
                      onClick={closeConfirm}
                      disabled={saving}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: COLORS.muted }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
