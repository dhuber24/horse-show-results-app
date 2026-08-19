import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchShowJudgesPublic,
  fetchShowFeesPublic,
} from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import ShowbillActions, { type ShowbillClassRow } from './ShowbillActions';

/**
 * The show bill — the prize list an exhibitor reads to decide whether to enter.
 *
 * Generated from the show's own records rather than uploaded as a PDF, so it
 * cannot fall out of date with the schedule it describes: a secretary who adds
 * a class or moves a fee has already updated this. That is the whole argument
 * for building it instead of adding a file upload — a stale PDF that disagrees
 * with the app is worse than no PDF, because people trust the one they printed.
 *
 * Downloading is the browser's print-to-PDF, driven by the stylesheet below.
 * See `ShowbillActions` for why that rather than a server-side renderer.
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
  percent_of_entry: '% of entry',
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

/** Print rules. Kept on the page rather than in globals.css because they only
 *  make sense for a document — every other screen wants the chrome. */
const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  .showbill-section { break-inside: avoid; }
  .showbill-day { break-inside: avoid; }
  a[href]::after { content: ""; }
  body { background: #ffffff !important; }
}
`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="showbill-section mt-6">
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

export default async function ShowbillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [show, allClasses, judges, fees, back] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowJudgesPublic(id),
    fetchShowFeesPublic(id),
    showHubBack(id),
  ]);

  // DRAFT classes are the secretary's working copy — they are not on offer yet
  // and printing them would advertise a class that may never run.
  const classes: ShowbillClassRow[] = (allClasses as ShowbillClassRow[]).filter(
    (c) => (c as unknown as { status: string }).status !== 'DRAFT',
  );

  const byDay = new Map<string, ShowbillClassRow[]>();
  for (const cls of classes) {
    if (!byDay.has(cls.class_date)) byDay.set(cls.class_date, []);
    byDay.get(cls.class_date)!.push(cls);
  }
  const days = Array.from(byDay.keys()).sort();

  const clubs: { association_id: string; code: string; name: string; per_class_fee_cents: number }[] =
    show.sanctioning ?? [];

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
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print">
        <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />
      </div>

      <ShowbillActions showName={show.name} classes={classes} />

      <article
        className="rounded-lg border p-5 md:p-7"
        style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
      >
        {/* Masthead. Repeated from the header above because the header is
            screen chrome and does not print — the printed sheet has to say
            which show it is on its own. */}
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

        {judges.length > 0 && (
          <Section title={judges.length === 1 ? 'Judge' : 'Judges'}>
            <ul className="text-sm space-y-1" style={{ color: '#2c1810' }}>
              {judges.map((j: { id: string; first_name: string; last_name: string }) => (
                <li key={j.id}>{j.first_name} {j.last_name}</li>
              ))}
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
            {fees.map((fee: {
              id: string;
              label: string;
              unit: string;
              amount_cents: number;
              notes: string | null;
              early_amount_cents: number | null;
              early_deadline: string | null;
            }) => (
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

      <div className="no-print mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href={`/shows/${id}/schedule`} className="hover:underline" style={{ color: '#8b4513' }}>
          Class schedule →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: '#8b4513' }}>
          Message the show office →
        </Link>
      </div>
    </main>
  );
}
