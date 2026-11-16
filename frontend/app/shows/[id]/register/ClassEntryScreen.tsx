'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BackNumberRequest from './BackNumberRequest';
import AddClassEntry from './AddClassEntry';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import { classEntryText } from '@/lib/registration-window';
import SignupClosedNotice from '../_components/SignupClosedNotice';
import { formatMoney, healthWarnings, type HorseNumber, type PreviewData } from './types';
import type { BillClassLine } from '@/lib/my-shows';
import { numbersEachHorse } from '@/lib/back-numbers';
import TeamEditor, { type SeatClubChoices, type TeamCandidate, type TeamHorseOption } from '@/components/TeamEditor';
import RiderClubs from '@/components/RiderClubs';
import type { ClubPointsSetup, RiderClubs as RiderClubsData } from '@/lib/clubs';
import { errorMessage } from '@/lib/api-error';
import { isTeamClass, riderLabel, teamShortLabel, teamSizeLabel, type TeamSeat } from '@/lib/teams';

/**
 * Class registration: the classes an exhibitor is entered in, the picker that
 * adds one, and the back number they ride under.
 *
 * **Its own page, apart from the registration wizard.** It was the wizard's last
 * step, which meant somebody coming back a week later to add the Saturday — the
 * commonest reason anybody reopens a registration — walked in through their
 * details, their horses and the stall picker to reach it. Signing up is done
 * once; classes are added and dropped for weeks. So the wizard (details,
 * memberships, horses, stalls where the show sells them, futurities) ends at
 * sign-up and hands off here, and My Shows has a button of its own for it.
 *
 * It is also what a running show's "My classes" opens: only the class doors stay
 * open once a show is ACTIVE (`backend/self_entry.py`) — entering a class that
 * has not started and scratching from one that has not finished — and this page
 * is exactly those doors. Where the show office answered that class changes
 * stop when the show starts (migration 159), the doors are shut from its first
 * day and the page is the list of what they are entered in.
 *
 * **Nothing here is a second implementation.** The picker is the same
 * `AddClassEntry` the desk's form mirrors, the table is the bill's own class
 * lines, and every figure comes from `billing.build_bill` on the backend.
 */

function formatDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * One class already entered, with the control to get back out of it.
 *
 * The desk removes an entry outright — a secretary is standing in front of the
 * person asking for it. This one confirms inline first: it is the exhibitor's
 * own money, usually on a phone, and an accidental tap that quietly drops them
 * from a class is not something they would notice until the gate.
 */
function EnteredRow({
  line,
  isConfirming,
  isRemoving,
  onAsk,
  onCancel,
  onConfirm,
  lockedReason,
  live,
  teamSlot,
}: {
  line: BillClassLine;
  isConfirming: boolean;
  isRemoving: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  /** Why this entry is the show office's to scratch now — its class is
   *  finished, or the horse has a result — or null. */
  lockedReason: string | null;
  /** The show is running, where the word at the gate is "scratch". */
  live: boolean;
  /** Who is on the team, in a team class (migration 192). */
  teamSlot?: React.ReactNode;
}) {
  const verb = live ? 'Scratch' : 'Remove';
  return (
    <tr className="border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
      <td className="py-1.5 pr-3" style={{ color: 'var(--foreground)' }}>
        <span className="font-mono" style={{ color: 'var(--accent)' }}>{line.class_number}</span>{' '}
        {line.class_name}
        {teamSlot}
      </td>
      <td className="py-1.5 pr-3" style={{ color: 'var(--foreground)' }}>
        {line.horse_name ?? '(horse removed)'}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {line.class_date ? formatDay(line.class_date) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap" style={{ color: 'var(--muted)' }}>
        {/* Everything charged on this class — its entry fee, a club's per-class
            fee, and the show's per-class fees the bill counted on it — the same
            figure the desk prints, so a $0 class carrying a $5 per-class fee
            reads $5.00 here rather than $0.00. A class the office made free
            says so. */}
        {line.is_free ? 'Free' : formatMoney(line.fee_cents + line.sanction_cents + (line.charge_cents ?? 0))}
        {/* Covered by an All Day fee (migration 186): the class's own fee is in
            that fee, which is on the bill below. */}
        {line.all_day_fee_id != null && (
          <span
            className="block text-xs"
            title={`${formatMoney(line.list_fee_cents ?? 0)} class fee, covered by ${
              line.all_day_label ?? 'the All Day fee'
            }`}
          >
            All Day
          </span>
        )}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {lockedReason ? (
          // Not a disabled button: there is nothing to press, and the line
          // under the table says who to ask. `title` carries the exact reason.
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }} title={lockedReason}>
            Office only
          </span>
        ) : isConfirming ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isRemoving}
              className="text-xs font-medium px-2 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--error)' }}
            >
              {isRemoving ? `${verb === 'Scratch' ? 'Scratching' : 'Removing'}…` : `Yes, ${verb.toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isRemoving}
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: 'var(--muted)' }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onAsk}
            className="text-xs hover:underline"
            style={{ color: 'var(--error)' }}
            title={`${verb} ${line.horse_name ?? 'this horse'} from ${line.class_name}`}
            aria-label={`${verb} ${line.horse_name ?? 'this horse'} from ${line.class_name}`}
          >
            {verb}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ClassEntryScreen({
  showId,
  preview,
}: {
  showId: string;
  preview: PreviewData;
}) {
  const router = useRouter();
  const { show, exhibitor, classes, horses, existing_entries, bill } = preview;
  const signedUp = preview.signup !== null;
  // The show is running. Only the class doors stay open (`backend/self_entry.py`)
  // — entering a class that has not started and scratching from one that has
  // not finished.
  const live = show.status === 'ACTIVE';
  // The show's own answer to how late classes change online (migration 159).
  // False at a running show whose office said class changes stop when it
  // starts, and always at a show whose office makes every class change
  // (`office_only`, migration 185); each class's own state still applies on
  // top while it is true.
  const classEntryOpen = preview.registration?.class_entry_open !== false;
  const classEntryCloses = preview.registration?.class_entry_closes ?? 'class_start';
  const officeOnly = classEntryCloses === 'office_only';
  const officeOnlyText =
    'At this show the show office enters and scratches every class. Send them a message to add or drop one.';
  const signupOpen = preview.registration?.signup_open !== false;
  const registrationHref = `/shows/${showId}/register`;

  const scratchLocks = useMemo(
    () => new Map(existing_entries.map((e) => [e.id, e.scratch_locked ?? null])),
    [existing_entries],
  );
  const horsesNeedingRecords = useMemo(
    () => horses.filter((h) => healthWarnings(h).length > 0),
    [horses],
  );

  const [confirmWithdrawEntryId, setConfirmWithdrawEntryId] = useState<string | null>(null);
  const [withdrawingEntryId, setWithdrawingEntryId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleWithdraw = async (entryId: string) => {
    setWithdrawError(null);
    setWithdrawingEntryId(entryId);
    try {
      const res = await fetch(`/api/shows/${showId}/register/entries/${entryId}`, {
        method: 'DELETE',
      });
      if (res.status !== 204 && !res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail = typeof json?.detail === 'string'
          ? json.detail
          : json?.detail?.message || json?.error || 'Withdraw failed';
        setWithdrawError(detail);
        setWithdrawingEntryId(null);
        return;
      }
      setConfirmWithdrawEntryId(null);
      setWithdrawingEntryId(null);
      router.refresh();
    } catch {
      setWithdrawError('Network error — please try again.');
      setWithdrawingEntryId(null);
    }
  };

  // ── Teams (migration 192) ───────────────────────────────────────────────
  // A team class is entered like any other; whoever entered names the rest of
  // the team here, from the riders at this show, until the class goes in.
  const entryById = useMemo(() => new Map(existing_entries.map((e) => [e.id, e])), [existing_entries]);
  const teamSizeByClass = useMemo(
    () => new Map(classes.map((c) => [c.id, c.team_size ?? null])),
    [classes],
  );
  const [editingTeam, setEditingTeam] = useState<string | null>(null);

  const findTeammates = async (query: string): Promise<TeamCandidate[]> => {
    const res = await fetch(`/api/shows/${showId}/register/teammates?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    return (await res.json().catch(() => [])) ?? [];
  };

  const teammateHorses = async (exhibitorId: string): Promise<TeamHorseOption[]> => {
    const res = await fetch(`/api/shows/${showId}/register/teammates/${exhibitorId}/horses`);
    if (!res.ok) return [];
    return (await res.json().catch(() => [])) ?? [];
  };

  // ── Saddle club (migration 193) ─────────────────────────────────────────
  // Which club(s) they ride for here, where the show keeps club standings.
  const [myClubs, setMyClubs] = useState<(ClubPointsSetup & { held: RiderClubsData['held']; declared: Omit<RiderClubsData, 'held'> | null }) | null>(null);
  const loadClubs = () =>
    fetch(`/api/shows/${showId}/register/clubs`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setMyClubs)
      .catch(() => setMyClubs(null));
  useEffect(() => {
    if (signedUp) loadClubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId, signedUp]);
  const saveMyClubs = async (clubIds: string[], primaryId: string | null): Promise<string | null> => {
    const res = await fetch(`/api/shows/${showId}/register/clubs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ club_ids: clubIds, primary_id: primaryId }),
    });
    if (!res.ok) return errorMessage(await res.json().catch(() => null), 'Could not save your club.');
    setMyClubs(await res.json());
    return null;
  };
  /** Their own declared clubs, for "rides for" on a team they enter. */
  const myClubChoices = (exhibitorId: string): SeatClubChoices | null => {
    if (exhibitorId !== exhibitor.id || !myClubs?.declared) return null;
    const names = new Map(myClubs.held.map((c) => [c.id, c.name]));
    return {
      primaryId: myClubs.declared.primary_id,
      clubs: myClubs.declared.club_ids.map((id) => ({ id, name: names.get(id) ?? 'Club' })),
    };
  };

  const saveTeam = async (entryId: string, seats: TeamSeat[], entrantClubId: string | null): Promise<string | null> => {
    const res = await fetch(`/api/shows/${showId}/register/entries/${entryId}/team`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: seats, entrant_club_id: entrantClubId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return errorMessage(body, 'Could not save your team.');
    }
    setEditingTeam(null);
    router.refresh();
    return null;
  };

  const teamRides = preview.team_rides ?? [];

  const entered = bill.class_lines;

  return (
    <div className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
        {live || officeOnly ? 'My classes' : 'Class registration'} — {exhibitor.full_name}
      </p>

      <div
        className="mt-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        {officeOnly
          ? officeOnlyText
          : live
            ? !classEntryOpen
              ? 'The show is under way, and the show office makes every class change now. Ask at the office to enter or scratch a class.'
              : signedUp
                ? 'The show is under way. You can enter a class that hasn’t started and scratch from one that hasn’t finished. Once a class is finished, only the show office can take you out of it.'
                : 'The show is under way and online sign-up has closed.'
            : signedUp
              ? `Pick a class and a horse — each entry saves as you add it. ${classEntryText(classEntryCloses)} Fees shown here are what the office will collect at the show.`
              : signupOpen
                ? 'Class entry opens once you’ve signed up for this show.'
                : 'Class entry is for exhibitors signed up for this show, and online sign-up has closed.'}
      </div>

      {signedUp ? (
        <section
          id="registration-classes"
          className="mt-4 rounded-lg border p-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {/* First inside on purpose: people who ride the same number every year
              come here to claim it, and burying it under the class table would
              mean they only remember at the desk. */}
          {numbersEachHorse(preview.back_number_per) ? (
            // A show that numbers horses (migration 161) or pairs (migration
            // 178): a number per horse, each arriving with its first entry.
            <HorseNumbers
              showId={showId}
              horses={preview.horse_numbers ?? []}
              live={live}
              pair={preview.back_number_per === 'pair'}
            />
          ) : live ? (
            // Asking for a number closes when the show opens — the numbers are on
            // backs by then — so a running show states the one they have.
            <p className="text-sm" style={{ color: 'var(--foreground)' }}>
              {preview.signup?.back_number != null ? (
                <>
                  Your back number is{' '}
                  <span className="font-semibold">#{preview.signup.back_number}</span>.
                </>
              ) : (
                'No back number yet — the show office gives you one at the desk.'
              )}
            </p>
          ) : (
            <BackNumberRequest
              showId={showId}
              backNumber={preview.signup?.back_number ?? null}
              preferredBackNumber={preview.signup?.preferred_back_number ?? null}
            />
          )}

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                {entered.length === 0
                  ? 'Your classes'
                  : `You're entered in ${entered.length} class${entered.length === 1 ? '' : 'es'}`}
              </h2>
              {entered.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {/* What the rows below add up to: entry fees, per-class club
                      fees and the show's per-class fees. A club or a show fee
                      charging per horse or per exhibitor is not a class fee and
                      is in the bill further down, with its arithmetic. */}
                  {formatMoney(
                    bill.class_fee_total_cents +
                      (bill.all_day_total_cents ?? 0) +
                      bill.class_sanction_total_cents +
                      (bill.class_charge_total_cents ?? 0),
                  )}{' '}
                  in class fees
                </span>
              )}
            </div>

            {horses.length === 0 ? (
              <div
                className="rounded-lg border p-3 text-sm"
                style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning)' }}
              >
                {live ? (
                  'No horses on this registration — the show office can add one at the desk.'
                ) : (
                  <>
                    No horses on this registration yet.{' '}
                    <Link
                      href={`${registrationHref}?step=horses`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Add one to your registration →
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <>
                {entered.length === 0 ? (
                  <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                    {classEntryOpen
                      ? 'Nothing entered yet — pick a class below.'
                      : 'You’re not entered in any classes.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
                          <th className="text-left font-semibold pb-1 pr-3">Class</th>
                          <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                          <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Day</th>
                          <th className="text-right font-semibold pb-1 pr-3 whitespace-nowrap">Fee</th>
                          <th className="pb-1"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {entered.map((line) => {
                          const teamSize = teamSizeByClass.get(line.class_id) ?? null;
                          const existing = entryById.get(line.entry_id);
                          const team = existing?.team_members ?? [];
                          const teamShort = existing?.team_short ?? 0;
                          // The class doors, and the class not yet in the ring.
                          const teamLocked = !classEntryOpen || Boolean(existing?.team_locked);
                          return (
                          <Fragment key={line.entry_id}>
                          <EnteredRow
                            line={line}
                            teamSlot={
                              isTeamClass(teamSize) ? (
                                <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                                  {teamSizeLabel(teamSize)}: {riderLabel('You', team)}
                                  {teamShort > 0 && (
                                    <span className="ml-1 font-medium" style={{ color: 'var(--warning-strong)' }}>
                                      · {teamShortLabel(teamShort)}
                                    </span>
                                  )}{' '}
                                  {!teamLocked && editingTeam !== line.entry_id && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingTeam(line.entry_id)}
                                      className="ml-1 hover:underline"
                                      style={{ color: 'var(--accent)' }}
                                    >
                                      {team.length > 0 ? 'Change your team' : 'Name your team'}
                                    </button>
                                  )}
                                </span>
                              ) : undefined
                            }
                            isConfirming={confirmWithdrawEntryId === line.entry_id}
                            isRemoving={withdrawingEntryId === line.entry_id}
                            onAsk={() => {
                              setConfirmWithdrawEntryId(line.entry_id);
                              setWithdrawError(null);
                            }}
                            onCancel={() => {
                              setConfirmWithdrawEntryId(null);
                              setWithdrawError(null);
                            }}
                            onConfirm={() => handleWithdraw(line.entry_id)}
                            lockedReason={
                              classEntryOpen
                                ? scratchLocks.get(line.entry_id) ?? null
                                : officeOnly
                                  ? 'The show office makes every class change at this show.'
                                  : 'The show office makes class changes now that the show is under way.'
                            }
                            live={live}
                          />
                          {isTeamClass(teamSize) && editingTeam === line.entry_id && (
                            <tr>
                              <td colSpan={5} className="pb-2">
                                <TeamEditor
                                  teamSize={teamSize}
                                  entrantName="You"
                                  teamHorseName={line.horse_name}
                                  members={team}
                                  findRiders={findTeammates}
                                  loadHorses={teammateHorses}
                                  onSave={(seats, entrantClubId) => saveTeam(line.entry_id, seats, entrantClubId)}
                                  clubChoices={myClubChoices}
                                  entrantId={exhibitor.id}
                                  entrantClubId={existing?.entrant_club_id ?? null}
                                  onCancel={() => setEditingTeam(null)}
                                  notFoundHint="Every rider on a team signs up for the show first — or ask the show office to add them."
                                />
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    {/* Said once under the table rather than per row, because a
                        tooltip is no help on a phone. */}
                    {classEntryOpen && entered.some((line) => scratchLocks.get(line.entry_id)) && (
                      <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                        <span className="font-medium">Office only</span>: that class is finished, or
                        your horse already has a result in it — only the show office can take you
                        out of it now.
                      </p>
                    )}
                  </div>
                )}

                {/* The saddle club(s) they ride for (migration 193), from the
                    club memberships on their profile, which the desk verifies. */}
                {myClubs?.enabled && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
                      Your saddle club
                    </h3>
                    <RiderClubs
                      key={`${myClubs.declared?.club_ids.join(',')}-${myClubs.declared?.primary_id}`}
                      clubs={{
                        held: myClubs.held,
                        club_ids: myClubs.declared?.club_ids ?? [],
                        primary_id: myClubs.declared?.primary_id ?? null,
                        derived: myClubs.declared?.derived ?? false,
                      }}
                      clubsPerRider={myClubs.clubs_per_rider}
                      onSave={saveMyClubs}
                      noClubHint="Add your club to the memberships on your profile — the show office checks it at the desk."
                    />
                  </div>
                )}

                {/* Teams another rider entered with this exhibitor on them
                    (migration 192): their entry and their fee, so not in the
                    table above — but a class this rider rides in all the same. */}
                {teamRides.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
                      Teams you ride on
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {teamRides.map((ride) => (
                        <li key={ride.entry_id} style={{ color: 'var(--foreground)' }}>
                          <span className="font-mono" style={{ color: 'var(--accent)' }}>{ride.class_number}</span>{' '}
                          {ride.class_name}
                          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                            On {ride.entrant_name ?? 'another rider'}&rsquo;s team
                            {ride.horse_name ?? ride.team_horse_name
                              ? `, riding ${ride.horse_name ?? ride.team_horse_name}`
                              : ''}
                            {ride.class_date ? ` — ${formatDay(ride.class_date)}` : ''}. They entered it and
                            pay its fee; ask them to change the team.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {classEntryOpen && (
                  <AddClassEntry
                    showId={showId}
                    showTypeCode={show.show_type_code}
                    classes={classes}
                    horses={horses}
                    existingEntries={existing_entries}
                    onAdded={() => router.refresh()}
                  />
                )}
              </>
            )}

            {withdrawError && (
              <div
                className="mt-3 rounded-lg border p-3 text-sm"
                style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
              >
                {withdrawError}
              </div>
            )}
          </div>

          {/* Advisory, never a gate — the entry goes in either way and the office
              gets the same list with time to chase it. In here rather than at the
              top of the page because it is about the horses in the table above
              it. */}
          {horsesNeedingRecords.length > 0 && (
            <div
              className="mt-4 rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
                {horsesNeedingRecords.length === 1
                  ? '1 horse needs'
                  : `${horsesNeedingRecords.length} horses need`}{' '}
                health records updated before the show
              </p>
              <p className="text-xs" style={{ color: 'var(--warning)' }}>
                You can still enter — the office expects current paperwork when you ship in.
              </p>
              <ul className="space-y-1.5">
                {horsesNeedingRecords.map((h) => {
                  const warnings = healthWarnings(h);
                  return (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                    >
                      <span style={{ color: 'var(--warning-strong)' }}>
                        <span className="font-medium">{h.name}</span>
                        {' — '}
                        {warnings[0] ?? 'documents needed'}
                      </span>
                      <Link
                        href={`/profile/horses/${h.id}`}
                        className="shrink-0 text-xs font-medium hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        Upload documents →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ) : live ? (
        // Not signed up: the class door needs a sign-up behind it
        // (`SHOW_SIGNUP_REQUIRED`), and sign-up closed with the show's opening.
        // The office still often takes a late entry at the counter.
        <div
          className="mt-4 rounded-lg border p-4 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
        >
          Ask the show office whether they are still taking entries.{' '}
          <Link
            href={`/shows/${showId}/contact?about=entering`}
            className="font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Message the show office →
          </Link>
        </div>
      ) : !signupOpen ? (
        // Past the last day to sign up online (migration 159): the wizard would
        // turn them away, so the office is the way in.
        <SignupClosedNotice showId={showId} deadline={preview.registration?.signup_deadline ?? null} />
      ) : (
        // A destination, not a locked box: the registration wizard opens on
        // whichever step is still outstanding, so one link covers every case.
        <div
          className="mt-4 rounded-lg border p-4 text-sm flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
        >
          <span>Finish your registration first — your details, your horses and signing up.</span>
          <Link
            href={registrationHref}
            className="text-sm font-medium px-3 py-1.5 rounded text-white shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Continue registration →
          </Link>
        </div>
      )}

      {/* Only once there is a bill to read: somebody not yet signed up and not
          entered by the office owes nothing, and a column of $0.00 lines reads
          as a registration that cost nothing. */}
      {(signedUp || entered.length > 0) && (
        <section
          className="mt-4 rounded-lg border p-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        >
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            What this show will cost
          </h2>
          {/* The same `build_bill` the office reads and the same one on My
              Shows, so the three cannot disagree. */}
          <ShowBillBreakdown bill={bill} />
        </section>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-sm font-medium">
        {/* Details, horses, stalls and futurities stay editable until the show
            starts, and they live on the registration wizard. */}
        {!live && signedUp && (
          <Link href={registrationHref} className="hover:underline" style={{ color: 'var(--accent)' }}>
            My registration →
          </Link>
        )}
        <Link
          href={`/shows/${showId}/showbill`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Show bill &amp; fee schedule →
        </Link>
        <Link
          href={`/shows/${showId}/schedule`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Browse the full class schedule →
        </Link>
        <Link href="/my-shows" className="hover:underline" style={{ color: 'var(--accent)' }}>
          All my shows →
        </Link>
      </div>
    </div>
  );
}

/** Each entered horse's back number, at a show that numbers horses — or the
 *  exhibitor's own on each horse, at one that numbers pairs. While the show is
 *  taking entries each one can be asked for, as the exhibitor's own number can
 *  elsewhere; once it is running they are stated. */
function HorseNumbers({
  showId,
  horses,
  live,
  pair,
}: {
  showId: string;
  horses: HorseNumber[];
  live: boolean;
  pair: boolean;
}) {
  if (horses.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {pair
          ? 'This show gives you a back number for each horse you show. Enter a horse in a class and its number appears here.'
          : 'This show gives each horse its own back number. Enter a horse in a class and its number appears here.'}
      </p>
    );
  }
  if (live) {
    return (
      <div className="text-sm" style={{ color: 'var(--foreground)' }}>
        <p className="font-semibold">Your back numbers</p>
        <ul className="mt-1 space-y-0.5">
          {horses.map((h) => (
            <li key={h.horse_id}>
              {h.horse_name}:{' '}
              {h.back_number != null ? (
                <span className="font-semibold">#{h.back_number}</span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>the show office gives it a number at the desk</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {horses.map((h) => (
        <BackNumberRequest
          key={h.horse_id}
          showId={showId}
          backNumber={h.back_number}
          preferredBackNumber={h.preferred_back_number}
          horse={{ id: h.horse_id, name: h.horse_name }}
          pair={pair}
        />
      ))}
    </div>
  );
}
