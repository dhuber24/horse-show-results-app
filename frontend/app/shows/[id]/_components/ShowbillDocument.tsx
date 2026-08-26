/**
 * The show bill — the prize list an exhibitor reads to decide whether to enter.
 *
 * Generated from the show's own records rather than uploaded as a PDF, so it
 * cannot fall out of date with the schedule it describes: a secretary who adds
 * a class or moves a fee has already updated this. That is the whole argument
 * for building it instead of adding a file upload — a stale PDF that disagrees
 * with the app is worse than no PDF, because people trust the one they printed.
 *
 * Two callers, one document. `/shows/[id]/showbill` renders it whole, with the
 * masthead and the print stylesheet, because that route exists to be printed.
 * Show Details renders it `embedded`, below the facts card — the bill stopped
 * being a tile on the show menu, since "judges, classes, fees and rules" is
 * what somebody opening Show Details is already asking for, and a second click
 * to a near-identical page was the app making them ask twice.
 *
 * `embedded` drops the masthead and **The show** section: they restate the card
 * directly above them. Everything below that is what the bill adds.
 */

const UNIT_LABEL: Record<string, string> = {
  flat: 'flat',
  per_entry: 'per entry',
  per_horse: 'per horse',
  per_judge: 'per judge',
  per_class_per_horse: 'per class, per horse',
  per_night: 'per night',
  per_stall: 'per stall',
  per_bag: 'per bag',
  per_show: 'per show',
  percent_of_entry: '% of entry',
};

export type ShowbillClassRow = {
  class_number: string;
  class_name: string;
  class_date: string;
  discipline_name: string | null;
  division_name: string | null;
  ring_name: string | null;
  entry_fee_cents: number;
};

type Club = { association_id: string; code: string; name: string; per_class_fee_cents: number };
type Judge = { id: string; first_name: string; last_name: string };
type Fee = {
  id: string;
  label: string;
  unit: string;
  amount_cents: number;
  notes: string | null;
  early_amount_cents: number | null;
  early_deadline: string | null;
};

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="showbill-section mt-6 first:mt-0">
      <h2
        className="text-sm font-bold uppercase tracking-wider pb-1 mb-3 border-b"
        style={{ color: '#8b4513', borderColor: '#d4b896' }}
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
        style={{ color: '#8b7355' }}>
        {label}
      </div>
      <div className="text-sm" style={{ color: '#2c1810' }}>{children}</div>
    </div>
  );
}

/** A futurity as published programme — see `fetchShowFuturitiesPublic`. */
export type ShowbillFuturity = {
  id: string;
  name: string;
  description: string | null;
  entry_deadline: string | null;
  late_fee_cents: number;
  office_fee_member_cents: number;
  office_fee_nonmember_cents: number;
  classes: { class_id: string; class_number: string; class_name: string }[];
  fee_tiers: {
    id: string;
    name: string;
    description: string | null;
    amount_cents: number;
  }[];
  divisions: {
    id: string;
    name: string;
    classes: {
      class_number: string | null;
      class_name: string | null;
      scoring: string;
      group_name: string | null;
    }[];
  }[];
};

export default function ShowbillDocument({
  show,
  classes,
  judges,
  fees,
  futurities = [],
  embedded = false,
}: {
  // Straight off `fetchShow`, which is untyped — the same shape every other
  // show screen reads it as.
  show: any;
  classes: ShowbillClassRow[];
  judges: Judge[];
  fees: Fee[];
  /** Defaults to empty so the details page, which does not load them, is
   *  unchanged — and a show with no futurity prints no futurity section. */
  futurities?: ShowbillFuturity[];
  embedded?: boolean;
}) {
  const byDay = new Map<string, ShowbillClassRow[]>();
  for (const cls of classes) {
    if (!byDay.has(cls.class_date)) byDay.set(cls.class_date, []);
    byDay.get(cls.class_date)!.push(cls);
  }
  const days = Array.from(byDay.keys()).sort();

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

  return (
    <article
      className="rounded-lg border p-5 md:p-7"
      style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
    >
      {/* Masthead. Repeated from the page header above because the header is
          screen chrome and does not print — the printed sheet has to say which
          show it is on its own. Embedded it would be the third time the show
          name appears in a screenful, so it goes. */}
      {!embedded && (
        <header className="text-center pb-4 mb-2 border-b-2" style={{ borderColor: '#8b4513' }}>
          <h1 className="text-3xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
          <p className="text-sm mt-2" style={{ color: '#5d4a37' }}>
            {formatShortDate(show.start_date)}
            {show.end_date !== show.start_date && <> – {formatShortDate(show.end_date)}</>}
          </p>
          {show.venue && (
            <p className="text-sm mt-0.5" style={{ color: '#5d4a37' }}>{show.venue}</p>
          )}
          {(show.show_type_code || clubs.length > 0) && (
            <p className="text-xs mt-2 font-mono font-semibold" style={{ color: '#8b4513' }}>
              {[show.show_type_code, ...clubs.map((c) => c.code)].filter(Boolean).join(' · ')}
            </p>
          )}
        </header>
      )}

      {!embedded && (
        <Section title="The show">
          <div className="divide-y" style={{ borderColor: '#f0e4d0' }}>
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
                      {club.per_class_fee_cents > 0 && (
                        <span style={{ color: '#8b7355' }}>
                          {' '}— {formatMoney(club.per_class_fee_cents)} per class
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
      )}

      {judges.length > 0 && (
        <Section title={judges.length === 1 ? 'Judge' : 'Judges'}>
          <ul className="text-sm space-y-1" style={{ color: '#2c1810' }}>
            {judges.map((j) => <li key={j.id}>{j.first_name} {j.last_name}</li>)}
          </ul>
        </Section>
      )}

      <Section title="Class schedule">
        {days.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>
            No classes have been posted yet.
          </p>
        ) : (
          <div className="space-y-5">
            {days.map((day) => (
              <div key={day} className="showbill-day">
                <h3 className="text-sm font-semibold mb-2" style={{ color: '#8b4513' }}>
                  {formatDate(day)}
                </h3>
                <table className="w-full text-sm" style={{ color: '#2c1810' }}>
                  <tbody>
                    {byDay.get(day)!.map((cls, i) => (
                      <tr
                        key={`${cls.class_number}-${i}`}
                        className="border-b last:border-b-0"
                        style={{ borderColor: '#f0e4d0' }}
                      >
                        <td className="py-1.5 pr-2 align-top font-mono font-semibold whitespace-nowrap"
                          style={{ color: '#8b4513' }}>
                          {cls.class_number}
                        </td>
                        <td className="py-1.5 pr-2 align-top w-full">
                          {cls.class_name}
                          {(cls.discipline_name || cls.division_name || cls.ring_name) && (
                            <div className="text-xs" style={{ color: '#8b7355' }}>
                              {[cls.discipline_name, cls.division_name, cls.ring_name]
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
        )}
      </Section>

      <Section title="Fees">
        <div className="divide-y" style={{ borderColor: '#f0e4d0' }}>
          {show.office_charge_cents > 0 && (
            <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <div style={{ color: '#2c1810' }}>
                Office charge
                <span className="text-xs" style={{ color: '#8b7355' }}>
                  {' '}({show.office_charge_basis === 'per_horse'
                    ? 'per horse'
                    : 'per back number'})
                </span>
              </div>
              <div className="font-medium whitespace-nowrap" style={{ color: '#2c1810' }}>
                {formatMoney(show.office_charge_cents)}
              </div>
            </div>
          )}
          {fees.map((fee) => (
            <div key={fee.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <div style={{ color: '#2c1810' }}>
                {fee.label}
                <span className="text-xs" style={{ color: '#8b7355' }}>
                  {' '}({UNIT_LABEL[fee.unit] ?? fee.unit})
                </span>
                {fee.notes && (
                  <div className="text-xs" style={{ color: '#8b7355' }}>{fee.notes}</div>
                )}
                {fee.early_amount_cents != null && fee.early_deadline != null && (
                  <div className="text-xs font-medium" style={{ color: '#15803d' }}>
                    {formatMoney(fee.early_amount_cents)} if reserved by{' '}
                    {formatShortDate(fee.early_deadline)}
                  </div>
                )}
              </div>
              <div className="font-medium whitespace-nowrap" style={{ color: '#2c1810' }}>
                {formatMoney(fee.amount_cents)}
              </div>
            </div>
          ))}
          {fees.length === 0 && show.office_charge_cents === 0 && (
            <p className="text-sm py-2" style={{ color: '#8b7355' }}>
              No stall, shavings or camping fees have been published for this show.
            </p>
          )}
        </div>
        <p className="text-xs mt-3" style={{ color: '#8b7355' }}>
          The show office collects payment at the show — this app does not take payment.
        </p>
      </Section>

      {futurities.length > 0 && (
        <Section title="Futurities">
          {futurities.map((futurity) => (
            <div key={futurity.id} className="showbill-section mb-4 last:mb-0">
              <h3 className="font-semibold text-sm" style={{ color: '#2c1810' }}>
                {futurity.name}
              </h3>
              {futurity.description && (
                <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                  {futurity.description}
                </p>
              )}

              {futurity.classes.length > 0 && (
                <p className="text-sm mt-1" style={{ color: '#2c1810' }}>
                  <span className="text-xs" style={{ color: '#8b7355' }}>
                    Classes:{' '}
                  </span>
                  {futurity.classes.map((c) => c.class_number).join(', ')}
                </p>
              )}

              {/* The entry fee is per class and per category, which is exactly
                  what a paper bill prints — a single "futurity fee" number
                  would be wrong for two entrants out of three. */}
              {futurity.fee_tiers.length > 0 && (
                <ul className="mt-1 text-sm" style={{ color: '#2c1810' }}>
                  {futurity.fee_tiers.map((tier) => (
                    <li key={tier.id} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span>
                        {tier.name}
                        {tier.description && (
                          <span className="text-xs" style={{ color: '#8b7355' }}>
                            {' '}— {tier.description}
                          </span>
                        )}
                      </span>
                      <span className="font-medium whitespace-nowrap">
                        {formatMoney(tier.amount_cents)}
                        <span className="text-xs font-normal" style={{ color: '#8b7355' }}>
                          {' '}/ class
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <ul className="mt-1 text-xs" style={{ color: '#8b7355' }}>
                {futurity.entry_deadline && (
                  <li>
                    Entries close {formatShortDate(futurity.entry_deadline)}
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
                    Hi-Point {division.name}:{' '}
                    {division.classes.map((c) => `#${c.class_number}`).join(', ')}
                    {division.classes.some((c) => c.scoring === 'best_of_group') &&
                      ' (best one of the grouped classes counts)'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}

      <Section title="Rules & paperwork">
        <div className="divide-y" style={{ borderColor: '#f0e4d0' }}>
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
            </Fact>
          )}
        </div>
      </Section>

      <footer className="mt-8 pt-3 border-t text-xs" style={{ borderColor: '#d4b896', color: '#8b7355' }}>
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
