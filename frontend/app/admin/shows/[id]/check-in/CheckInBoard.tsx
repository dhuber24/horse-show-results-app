'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CheckRow, { type VerificationCheck, type VerificationKind } from './CheckRow';
import StaffAddHorseForm, { type AssociationOption, type LookupOption } from './StaffAddHorseForm';

interface VerificationHorse {
  horse_id: string;
  horse_name: string;
  barn_name: string | null;
  age_check: VerificationCheck;
  registrations: VerificationCheck[];
}

interface VerificationExhibitor {
  exhibitor_id: string;
  exhibitor_name: string;
  back_number: number | null;
  signed_up: boolean;
  memberships: VerificationCheck[];
  horses: VerificationHorse[];
  outstanding: number;
}

interface Checklist {
  show_id: string;
  exhibitors: VerificationExhibitor[];
  totals: {
    checks: number;
    verified: number;
    stale: number;
    unverified: number;
    not_on_file: number;
  };
}

/** The subject of a sign-off, as the backend wants it posted. */
type Subject = {
  kind: VerificationKind;
  horse_id?: string;
  exhibitor_id?: string;
  association_id?: string | null;
};

function busyKey(s: Subject): string {
  return [s.kind, s.horse_id ?? '', s.exhibitor_id ?? '', s.association_id ?? ''].join('|');
}

export default function CheckInBoard({
  showId,
  associations,
  breeds,
  colors,
}: {
  showId: string;
  associations: AssociationOption[];
  breeds: LookupOption[];
  colors: LookupOption[];
}) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shows/${showId}/verifications/checklist`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Could not load the check-in sheet.');
      setLoading(false);
      return;
    }
    setChecklist(await res.json());
    setError(null);
    setLoading(false);
  }, [showId]);

  useEffect(() => {
    load();
  }, [load]);

  const withBusy = async (subject: Subject, fn: () => Promise<Response>) => {
    const key = busyKey(subject);
    setBusy((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        setError(typeof detail === 'string' ? detail : detail?.message ?? 'That did not save.');
      }
      // Reload either way: a failure is usually someone else having changed the
      // same row, and the fresh sheet is what explains it.
      await load();
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const verify = (subject: Subject) =>
    withBusy(subject, () =>
      fetch(`/api/shows/${showId}/verifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject),
      }),
    );

  const undo = (subject: Subject, verificationId: string) =>
    withBusy(subject, () =>
      fetch(`/api/shows/${showId}/verifications/${verificationId}`, { method: 'DELETE' }),
    );

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const shown = useMemo(() => {
    if (!checklist) return [];
    let rows = checklist.exhibitors;
    if (outstandingOnly) rows = rows.filter((e) => e.outstanding > 0);
    if (tokens.length > 0) {
      rows = rows.filter((e) => {
        const hay = [
          e.exhibitor_name,
          e.back_number != null ? `#${e.back_number} ${e.back_number}` : '',
          ...e.horses.map((h) => `${h.horse_name} ${h.barn_name ?? ''}`),
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    return rows;
  }, [checklist, outstandingOnly, tokens]);

  if (loading) return <p style={{ color: '#8b7355' }}>Loading the check-in sheet…</p>;

  if (!checklist || checklist.exhibitors.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          Nobody is on this show&rsquo;s roster yet. Exhibitors appear here once they sign up
          or a secretary enters them in a class.
        </p>
      </div>
    );
  }

  const t = checklist.totals;
  const outstandingTotal = t.stale + t.unverified;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold" style={{ color: '#2c1810' }}>
            {t.verified} of {t.checks} verified
          </span>
          {t.stale > 0 && <span style={{ color: '#92400e' }}>{t.stale} changed since sign-off</span>}
          {t.unverified > 0 && <span style={{ color: '#8b4513' }}>{t.unverified} still to check</span>}
          {t.not_on_file > 0 && (
            <span style={{ color: '#8b7355' }}>{t.not_on_file} with nothing on file</span>
          )}
        </div>
        <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#f0e6d6' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${t.checks === 0 ? 0 : Math.round((t.verified / t.checks) * 100)}%`,
              backgroundColor: '#3f7d53',
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by exhibitor, horse or back #…"
          className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896', backgroundColor: '#ffffff', color: '#2c1810' }}
        />
        <button
          type="button"
          onClick={() => setOutstandingOnly((v) => !v)}
          aria-pressed={outstandingOnly}
          disabled={outstandingTotal === 0 && !outstandingOnly}
          title={
            outstandingTotal === 0
              ? 'Everything on file has been verified'
              : outstandingOnly
                ? 'Show everyone'
                : 'Show only people with paperwork left to check'
          }
          className="text-sm font-medium px-3 py-2 rounded-full border transition disabled:opacity-50"
          style={
            outstandingOnly
              ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
              : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }
          }
        >
          Outstanding only
        </button>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded border" style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>
          {error}
        </p>
      )}

      {shown.length === 0 && (
        <p style={{ color: '#8b7355' }}>
          {outstandingOnly ? 'Nothing outstanding matches that search.' : 'Nobody matches that search.'}
        </p>
      )}

      <div className="space-y-3">
        {shown.map((ex) => (
          <section
            key={ex.exhibitor_id}
            className="rounded-lg border p-4"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h3 className="font-semibold" style={{ color: '#2c1810' }}>
                  {ex.exhibitor_name}
                  {ex.back_number != null && (
                    <span className="ml-2 font-mono text-sm" style={{ color: '#8b4513' }}>
                      #{ex.back_number}
                    </span>
                  )}
                </h3>
                {!ex.signed_up && (
                  <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                    Added by staff — has not completed show sign-up.
                  </p>
                )}
              </div>
              <span
                className="text-xs font-medium px-2 py-1 rounded-full shrink-0"
                style={
                  ex.outstanding === 0
                    ? { backgroundColor: '#d1fae5', color: '#065f46' }
                    : { backgroundColor: '#fef3c7', color: '#92400e' }
                }
              >
                {ex.outstanding === 0 ? 'All checked' : `${ex.outstanding} to check`}
              </span>
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#8b4513' }}>
                Memberships
              </p>
              {ex.memberships.length === 0 ? (
                <p className="text-sm" style={{ color: '#8b7355' }}>
                  No association memberships on this profile.
                </p>
              ) : (
                ex.memberships.map((check) => {
                  const subject: Subject = {
                    kind: 'exhibitor_membership',
                    exhibitor_id: ex.exhibitor_id,
                    association_id: check.association_id,
                  };
                  return (
                    <CheckRow
                      key={check.association_id ?? 'none'}
                      label={check.association_code ?? 'Membership'}
                      check={check}
                      busy={busy.has(busyKey(subject))}
                      onVerify={() => verify(subject)}
                      onUndo={() => check.verification_id && undo(subject, check.verification_id)}
                    />
                  );
                })
              )}
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#8b4513' }}>
                Horses
              </p>
              {ex.horses.length === 0 ? (
                <p className="text-sm" style={{ color: '#8b7355' }}>
                  Not entered on any horse yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {ex.horses.map((horse) => (
                    <div
                      key={horse.horse_id}
                      className="rounded border p-3"
                      style={{ borderColor: '#f0e6d6', backgroundColor: '#fffdf9' }}
                    >
                      <p className="text-sm font-medium mb-1" style={{ color: '#2c1810' }}>
                        {horse.horse_name}
                        {horse.barn_name && (
                          <span className="ml-2 font-normal text-xs" style={{ color: '#8b7355' }}>
                            &ldquo;{horse.barn_name}&rdquo;
                          </span>
                        )}
                      </p>

                      {(() => {
                        const subject: Subject = { kind: 'horse_age', horse_id: horse.horse_id };
                        return (
                          <CheckRow
                            label="Age (foaling date)"
                            check={horse.age_check}
                            busy={busy.has(busyKey(subject))}
                            onVerify={() => verify(subject)}
                            onUndo={() =>
                              horse.age_check.verification_id &&
                              undo(subject, horse.age_check.verification_id)
                            }
                          />
                        );
                      })()}

                      {horse.registrations.length === 0 ? (
                        <p className="text-sm pt-2 border-t" style={{ borderColor: '#f0e6d6', color: '#8b7355' }}>
                          No registration numbers on file for this horse.
                        </p>
                      ) : (
                        horse.registrations.map((check) => {
                          const subject: Subject = {
                            kind: 'horse_registration',
                            horse_id: horse.horse_id,
                            association_id: check.association_id,
                          };
                          return (
                            <CheckRow
                              key={check.association_id ?? 'none'}
                              label={`${check.association_code ?? 'Registration'} registration`}
                              check={check}
                              busy={busy.has(busyKey(subject))}
                              onVerify={() => verify(subject)}
                              onUndo={() => check.verification_id && undo(subject, check.verification_id)}
                            />
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              )}

              {addingFor === ex.exhibitor_id ? (
                <StaffAddHorseForm
                  showId={showId}
                  exhibitorId={ex.exhibitor_id}
                  exhibitorName={ex.exhibitor_name}
                  associations={associations}
                  breeds={breeds}
                  colors={colors}
                  onCreated={() => {
                    setAddingFor(null);
                    load();
                  }}
                  onCancel={() => setAddingFor(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingFor(ex.exhibitor_id)}
                  className="mt-2 text-sm hover:underline"
                  style={{ color: '#8b4513' }}
                >
                  + Add a horse for {ex.exhibitor_name}
                </button>
              )}
              {/* A horse created here is owned by the exhibitor but not yet
                  entered — it shows up under them once it is in a class. */}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
