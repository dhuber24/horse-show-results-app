/**
 * The show bill — the prize list an exhibitor reads to decide whether to enter.
 *
 * Generated from the show's own records, so it cannot fall out of date with the
 * schedule it describes: a secretary who adds a class or moves a fee has already
 * updated this. That is why it is the default, and why it is the only bill this
 * component draws — a stale PDF that disagrees with the app is worse than no
 * PDF, because people trust the one they printed.
 *
 * A show may nonetheless supply its own bill (Setup step 9, migration 127), and
 * `UploadedShowbill` renders that. The two do not merge: `/shows/[id]/showbill`
 * prints this one beneath the upload, under its own heading, because it is
 * drawn from the fee list the app actually charges from and an uploaded PDF
 * must not be able to hide it.
 *
 * Always drawn whole — masthead, **The show** and all. It used to have an
 * `embedded` mode for Show Details, which printed it below its own facts card;
 * the bill came off that page, and under an uploaded bill **The show** is the
 * section carrying the club sanction rates, which are money the app charges.
 */

import { groupFees, unitLabel } from '@/lib/fee-units';
import { runsOf } from '@/lib/class-order';

export type ShowbillClassRow = {
  /** Optional so a caller building rows by hand still type-checks; without it
   *  a fee's class list has nothing to resolve against and is not printed. */
  id?: string;
  class_number: string;
  class_name: string;
  class_date: string;
  discipline_name: string | null;
  division_name: string | null;
  ring_name: string | null;
  entry_fee_cents: number;
  /** Codes of the clubs that sanction this class. Printed against the row
   *  because a per-class sanction fee is only owed on the classes the club
   *  approves — "NSBA, $3.00 per class" over a schedule with no per-class
   *  marking leaves an exhibitor unable to work out their own bill. */
  sanctioning_codes?: string[] | null;
};

type Club = {
  association_id: string;
  code: string;
  name: string;
  fee_amount_cents: number;
  /** What the amount counts (migration 133): per class entered, per horse, per
   *  exhibitor, or either of the last two times the judge panel. Printed with
   *  the rate, because "$45.00" against a club name is a number nobody
   *  reading a show bill can check. */
  fee_unit: string;
};
type Judge = { id: string; first_name: string; last_name: string };
type Fee = {
  id: string;
  label: string;
  unit: string;
  amount_cents: number;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
  /** The classes the fee is narrowed to (migration 137). Empty is every class,
   *  and prints nothing; a narrowed list is where an exhibitor reads which. */
  class_ids?: string[];
};

/**
 * Which classes a fee applies to, as the bill prints them: "Classes 4–9, 12".
 *
 * A narrowed per-class price with no classes beside it cannot be worked into a
 * bill — "$28 per class" over a 170-class schedule does not say which classes
 * cost $28 — so the list has to be on the page, not only in the editor. A fee
 * on every class (an empty list) prints nothing extra. Runs of
 * three or more adjacent classes collapse to a range, read off the schedule's
 * own order rather than by parsing numbers, since a class number is published
 * identity and not always an integer. Classes not on this bill (a DRAFT class,
 * say) are skipped, and a list covering every class on it reads "All classes".
 */
function feeClassesText(ids: string[] | undefined, classes: ShowbillClassRow[]): string | null {
  if (!ids || ids.length === 0) return null;
  const wanted = new Set(ids);
  const positions = classes.flatMap((c, i) => (c.id && wanted.has(c.id) ? [i] : []));
  if (positions.length === 0) return null;
  if (positions.length === classes.length) return 'All classes';

  const parts: string[] = [];
  let start = positions[0];
  let prev = start;
  const flush = () => {
    if (prev - start >= 2) {
      parts.push(`${classes[start].class_number}–${classes[prev].class_number}`);
    } else {
      for (let i = start; i <= prev; i++) parts.push(classes[i].class_number);
    }
  };
  for (const i of positions.slice(1)) {
    if (i === prev + 1) {
      prev = i;
      continue;
    }
    flush();
    start = i;
    prev = i;
  }
  flush();
  return `${positions.length === 1 ? 'Class' : 'Classes'} ${parts.join(', ')}`;
}

/** One heading, its "what these amounts mean" line, and the rows under it. */
function FeeGroup({
  heading,
  note,
  children,
}: {
  heading: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="showbill-section">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{heading}</h3>
      <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{note}</p>
      <div className="divide-y" style={{ borderColor: 'var(--bg-subtle)' }}>{children}</div>
    </div>
  );
}

function FeeRow({
  label,
  unitText,
  amountCents,
  notes,
  early,
  classesText,
}: {
  label: string;
  unitText: string;
  amountCents: number;
  notes?: string | null;
  early?: string | null;
  classesText?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <div style={{ color: 'var(--foreground)' }}>
        {label}
        <span className="text-xs" style={{ color: 'var(--muted)' }}> ({unitText})</span>
        {classesText && (
          <div className="text-xs" style={{ color: 'var(--foreground)' }}>{classesText}</div>
        )}
        {notes && <div className="text-xs" style={{ color: 'var(--muted)' }}>{notes}</div>}
        {early && (
          <div className="text-xs font-medium" style={{ color: 'var(--success)' }}>{early}</div>
        )}
      </div>
      <div className="font-medium whitespace-nowrap" style={{ color: 'var(--foreground)' }}>
        {formatMoney(amountCents)}
      </div>
    </div>
  );
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatShortDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  /** An anchor, for the places that link straight to one section — the
   *  registration screen's futurity step points here rather than reprinting
   *  the whole programme beside its own controls. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="showbill-section mt-6 first:mt-0 scroll-mt-4">
      <h2
        className="text-sm font-bold uppercase tracking-wider pb-1 mb-3 border-b"
        style={{ color: 'var(--accent)', borderColor: 'var(--border)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide sm:w-36 shrink-0"
        style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-sm" style={{ color: 'var(--foreground)' }}>{children}</div>
    </div>
  );
}

/** A futurity as published programme — see `fetchShowFuturitiesPublic`. */
export type ShowbillFuturity = {
  id: string;
  name: string;
  description: string | null;
  entry_deadline: string | null;
  entry_deadline_time: string | null;
  entry_deadline_timezone: string | null;
  late_fee_cents: number;
  office_fee_member_cents: number;
  office_fee_nonmember_cents: number;
  entry_instructions: string | null;
  award_notice: string | null;
  rules_notice: string | null;
  refund_policy: string | null;
  classes: { class_id: string; class_number: string; class_name: string }[];
  fee_tiers: {
    id: string;
    name: string;
    description: string | null;
    amount_cents: number;
  }[];
  membership_options: {
    id: string;
    name: string;
    description: string | null;
    amount_cents: number;
  }[];
  divisions: {
    id: string;
    name: string;
    award_name: string | null;
    reserve_award_name: string | null;
    classes: {
      class_number: string | null;
      class_name: string | null;
      scoring: string;
      group_name: string | null;
    }[];
  }[];
};

/** "19:00:00" → "7:00 PM". A bare TIME is not something `new Date()` parses. */
function formatClockTime(value: string | null): string {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h)) return value;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

export default function ShowbillDocument({
  show,
  classes,
  judges,
  fees,
  futurities = [],
}: {
  // Straight off `fetchShow`, which is untyped — the same shape every other
  // show screen reads it as.
  show: any;
  classes: ShowbillClassRow[];
  judges: Judge[];
  fees: Fee[];
  /** A show with no futurity prints no futurity section. */
  futurities?: ShowbillFuturity[];
}) {
  const byDay = new Map<string, ShowbillClassRow[]>();
  for (const cls of classes) {
    if (!byDay.has(cls.class_date)) byDay.set(cls.class_date, []);
    byDay.get(cls.class_date)!.push(cls);
  }
  const days = Array.from(byDay.keys()).sort();

  /**
   * The day's classes under the discipline each one runs in.
   *
   * Runs of the printed order, never buckets. The bill prints `class_number`
   * beside every row and those numbers are how the gate, the entry form and
   * the office refer to a class, so a heading may describe the order and must
   * never re-sort it: bucketing would pull class 44 up under a heading printed
   * at class 8. A discipline the show genuinely runs twice in a day gets two
   * headings -- on a real Paint bill Halter, Performance Halter and Halter
   * again is exactly what runs -- and all three are true.
   *
   * A day that is all one discipline gets no headings, where the heading would
   * say nothing the class names do not.
   */
  const disciplineRuns = (rows: ShowbillClassRow[]) => {
    const distinct = new Set(rows.map((c) => c.discipline_name ?? ''));
    if (distinct.size < 2) return null;
    return runsOf(rows, (c) => c.discipline_name ?? 'Other');
  };

  const clubs: Club[] = show.sanctioning ?? [];

  const healthPapers = [
    show.requires_coggins ? 'Negative Coggins (EIA)' : null,
    show.requires_health_certificate
      ? `Certificate of Veterinary Inspection, issued within ${show.health_certificate_valid_days} days`
      : null,
    show.requires_vaccination
      ? `Vaccination record, within ${show.vaccination_valid_days} days${
          show.vaccination_notes ? ` — ${show.vaccination_notes}` : ''
        }`
      : null,
  ].filter(Boolean) as string[];
  // Whether to bring the originals, printed only where something is required
  // (migration 138). An exhibitor reading the bill is deciding what to put in
  // the truck, and "upload it" and "bring it" are different instructions.
  const healthPapersInPerson =
    healthPapers.length > 0 && show.requires_physical_document_check !== false;

  return (
    <article
      className="rounded-lg border p-5 md:p-7"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      {/* Masthead. Repeated from the page header above because the header is
          screen chrome and does not print — the printed sheet has to say which
          show it is on its own. */}
      <header className="text-center pb-4 mb-2 border-b-2" style={{ borderColor: 'var(--accent)' }}>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--text-deep)' }}>
          {formatShortDate(show.start_date)}
          {show.end_date !== show.start_date && <> – {formatShortDate(show.end_date)}</>}
        </p>
        {show.venue && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-deep)' }}>{show.venue}</p>
        )}
        {(show.show_type_code || clubs.length > 0) && (
          <p className="text-xs mt-2 font-mono font-semibold" style={{ color: 'var(--accent)' }}>
            {[show.show_type_code, ...clubs.map((c) => c.code)].filter(Boolean).join(' · ')}
          </p>
        )}
      </header>

      <Section title="The show">
        <div className="divide-y" style={{ borderColor: 'var(--bg-subtle)' }}>
          <Fact label="Dates">
            {formatDate(show.start_date)}
            {show.end_date !== show.start_date && <> through {formatDate(show.end_date)}</>}
          </Fact>
          {show.venue && <Fact label="Location">{show.venue}</Fact>}
          <Fact label="Show type">
            {show.show_type_name
              ? `${show.show_type_name}${show.show_type_code ? ` (${show.show_type_code})` : ''}`
              : (show.show_type_code ?? 'Open')}
          </Fact>
          {show.affiliations?.length > 0 && (
            <Fact label="Approved by">
              {show.affiliations.map((a: { show_type_code: string; show_type_name?: string }) =>
                a.show_type_name ? `${a.show_type_name} (${a.show_type_code})` : a.show_type_code,
              ).join(', ')}
            </Fact>
          )}
          {clubs.length > 0 && (
            <Fact label="Sanctioned by">
              <ul className="space-y-0.5">
                {clubs.map((club) => (
                  <li key={club.association_id}>
                    {club.name} ({club.code})
                    {club.fee_amount_cents > 0 && (
                      <span style={{ color: 'var(--muted)' }}>
                        {' '}— {formatMoney(club.fee_amount_cents)}{' '}
                        {unitLabel(club.fee_unit)}, on the classes marked{' '}
                        {club.code} below
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
          {show.apha_show_number && <Fact label="APHA show #">{show.apha_show_number}</Fact>}
          {show.aqha_show_number && <Fact label="AQHA show #">{show.aqha_show_number}</Fact>}
        </div>
      </Section>

      {judges.length > 0 && (
        <Section title={judges.length === 1 ? 'Judge' : 'Judges'}>
          <ul className="text-sm space-y-1" style={{ color: 'var(--foreground)' }}>
            {judges.map((j) => <li key={j.id}>{j.first_name} {j.last_name}</li>)}
          </ul>
        </Section>
      )}

      <Section title="Class schedule">
        {days.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No classes have been posted yet.
          </p>
        ) : (
          <div className="space-y-5">
            {days.map((day) => {
              const runs = disciplineRuns(byDay.get(day)!);
              const blocks = runs ?? [{ key: '', items: byDay.get(day)! }];
              return (
              <div key={day} className="showbill-day">
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--accent)' }}>
                  {formatDate(day)}
                </h3>
                {blocks.map((block, bi) => (
                <div key={`${block.key}-${bi}`} className={runs ? 'mb-3 last:mb-0' : undefined}>
                {runs && (
                  <h4
                    className="text-xs font-semibold uppercase tracking-wide mb-1 pb-0.5 border-b"
                    style={{ color: 'var(--text-deep)', borderColor: 'var(--bg-subtle)' }}
                  >
                    {block.key}
                  </h4>
                )}
                <table className="w-full text-sm" style={{ color: 'var(--foreground)' }}>
                  <tbody>
                    {block.items.map((cls, i) => (
                      <tr
                        key={`${cls.class_number}-${i}`}
                        className="border-b last:border-b-0"
                        style={{ borderColor: 'var(--bg-subtle)' }}
                      >
                        <td className="py-1.5 pr-2 align-top font-mono font-semibold whitespace-nowrap"
                          style={{ color: 'var(--accent)' }}>
                          {cls.class_number}
                        </td>
                        <td className="py-1.5 pr-2 align-top w-full">
                          {cls.class_name}
                          {(cls.sanctioning_codes ?? []).map((code) => (
                            <span
                              key={code}
                              className="text-xs ml-1.5 px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}
                            >
                              {code}
                            </span>
                          ))}
                          {/* The discipline is the heading above when the day
                              runs more than one, so printing it again on every
                              row would be the same word twice. */}
                          {[runs ? null : cls.discipline_name, cls.division_name, cls.ring_name]
                            .filter(Boolean).length > 0 && (
                            <div className="text-xs" style={{ color: 'var(--muted)' }}>
                              {[runs ? null : cls.discipline_name, cls.division_name, cls.ring_name]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 align-top text-right whitespace-nowrap">
                          {cls.entry_fee_cents > 0 ? formatMoney(cls.entry_fee_cents) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                ))}
              </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Grouped rather than listed, because a flat column of amounts with a
          parenthetical unit after each cannot be read as "what will this
          weekend cost me". The groups are the families `billing.py` bills by,
          so the heading over an amount is also the answer to whether it is
          something you order or something that simply arrives on the bill. See
          FEE_GROUPS in lib/fee-units.ts. */}
      <Section title="Fees">
        <div className="space-y-4">
          {/* The office charge had a group of its own here while it was a
              column on the show row. Migration 132 made it an ordinary
              `per_exhibitor` / `per_horse` fee, so it now prints under
              "Added to every entry" with the drug fees and assessments doing
              the same job — which is how an exhibitor reads it anyway. */}
          {groupFees(fees).map((group) => (
            <FeeGroup key={group.key} heading={group.heading} note={group.note}>
              {group.fees.map((fee) => (
                <FeeRow
                  key={fee.id}
                  label={fee.label}
                  unitText={unitLabel(fee.unit)}
                  amountCents={fee.amount_cents}
                  notes={fee.notes}
                  classesText={feeClassesText(fee.class_ids, classes)}
                  early={
                    fee.early_amount_cents != null && fee.early_deadline != null
                      ? `${formatMoney(fee.early_amount_cents)} if reserved by ${formatShortDate(
                          fee.early_deadline,
                        )}`
                      : null
                  }
                />
              ))}
            </FeeGroup>
          ))}

          {fees.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No stall, shavings or camping fees have been published for this show.
            </p>
          )}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
          Class entry fees are listed with the classes above. The show office collects payment at
          the show — this app does not take payment.
        </p>
      </Section>

      {futurities.length > 0 && (
        <Section title="Futurities" id="futurities">
          {futurities.map((futurity) => (
            <div key={futurity.id} className="showbill-section mb-4 last:mb-0">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
                {futurity.name}
              </h3>
              {futurity.description && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {futurity.description}
                </p>
              )}

              {/* The notices the club wrote, printed as written. A show bill
                  that stated the prices but dropped "horses may cross over" or
                  the refund rule would be the wrong document to hand somebody
                  at the entry booth. */}
              {futurity.award_notice && (
                <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>
                  {futurity.award_notice}
                </p>
              )}
              {futurity.rules_notice && (
                <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>
                  {futurity.rules_notice}
                </p>
              )}

              {futurity.classes.length > 0 && (
                <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    Classes:{' '}
                  </span>
                  {futurity.classes.map((c) => c.class_number).join(', ')}
                </p>
              )}

              {/* The entry fee is per class and per category, which is exactly
                  what a paper bill prints — a single "futurity fee" number
                  would be wrong for two entrants out of three. */}
              {futurity.entry_instructions && (
                <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>
                  {futurity.entry_instructions}
                </p>
              )}

              {futurity.fee_tiers.length > 0 && (
                <ul className="mt-1 text-sm" style={{ color: 'var(--foreground)' }}>
                  {futurity.fee_tiers.map((tier) => (
                    <li key={tier.id} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span>
                        {tier.name}
                        {tier.description && (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            {' '}— {tier.description}
                          </span>
                        )}
                      </span>
                      <span className="font-medium whitespace-nowrap">
                        {formatMoney(tier.amount_cents)}
                        <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
                          {' '}/ class
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {futurity.membership_options.length > 0 && (
                <ul className="mt-1 text-sm" style={{ color: 'var(--foreground)' }}>
                  {futurity.membership_options.map((option) => (
                    <li
                      key={option.id}
                      className="flex items-baseline justify-between gap-3 py-0.5"
                    >
                      <span>
                        {option.name}
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          {' '}
                          — optional club membership
                        </span>
                      </span>
                      <span className="font-medium whitespace-nowrap">
                        {formatMoney(option.amount_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <ul className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                {futurity.entry_deadline && (
                  <li>
                    Entries close {formatShortDate(futurity.entry_deadline)}
                    {futurity.entry_deadline_time &&
                      ` by ${formatClockTime(futurity.entry_deadline_time)}`}
                    {futurity.entry_deadline_timezone &&
                      ` ${futurity.entry_deadline_timezone}`}
                    {futurity.late_fee_cents > 0 &&
                      ` — ${formatMoney(futurity.late_fee_cents)} per class after that`}
                  </li>
                )}
                {(futurity.office_fee_member_cents > 0 ||
                  futurity.office_fee_nonmember_cents > 0) && (
                  <li>
                    Office fee per horse: {formatMoney(futurity.office_fee_member_cents)}{' '}
                    member / {formatMoney(futurity.office_fee_nonmember_cents)} non-member
                  </li>
                )}
                {futurity.divisions.map((division) => (
                  <li key={division.id}>
                    Hi-Point {division.name}
                    {(division.award_name || division.reserve_award_name) &&
                      ` (${[division.award_name, division.reserve_award_name]
                        .filter(Boolean)
                        .join(' / ')})`}
                    : {division.classes.map((c) => `#${c.class_number}`).join(', ')}
                    {division.classes.some((c) => c.scoring === 'best_of_group') &&
                      ' (best one of the grouped classes counts)'}
                  </li>
                ))}
                {futurity.refund_policy && <li>{futurity.refund_policy}</li>}
              </ul>
            </div>
          ))}
        </Section>
      )}

      <Section title="Rules & paperwork">
        <div className="divide-y" style={{ borderColor: 'var(--bg-subtle)' }}>
          <Fact label="Shavings">
            {show.shavings_ban_outside
              ? 'Outside shavings are not allowed. Bedding must be bought from the show.'
              : 'Outside shavings are allowed. Bags may also be ordered from the show.'}
          </Fact>
          {healthPapers.length > 0 && (
            <Fact label="Health papers">
              <ul className="space-y-0.5">
                {healthPapers.map((paper) => <li key={paper}>{paper}</li>)}
              </ul>
              {healthPapersInPerson && (
                <p className="mt-1">Bring the originals — the show office checks them at the desk.</p>
              )}
            </Fact>
          )}
        </div>
      </Section>

      <footer className="mt-8 pt-3 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        <p>
          Generated from this show&rsquo;s records on{' '}
          {new Date().toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          })}
          . The show office is the authority on anything printed here.
        </p>
      </footer>
    </article>
  );
}
