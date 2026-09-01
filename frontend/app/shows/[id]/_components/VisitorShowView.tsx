import Link from 'next/link';

/**
 * What a visitor with no account sees when they open a show.
 *
 * The class schedule is deliberately absent *from this page*. Someone browsing
 * shows is deciding whether to enter, and a wall of class numbers is not that
 * decision — what they can act on here is register, read the show up, or ask a
 * question. The shavings policy is absent for the same reason: it matters once
 * you're packing the trailer, so it lives on the sign-up screen where the bags
 * are ordered.
 *
 * **Show Details is offered to everyone, account or not.** What a show is, who
 * is judging it, what runs when and what it costs are the questions somebody
 * asks *before* deciding to enter, so putting the answer behind a registration
 * hides it at exactly the moment it is useful. `/shows/[id]/details` was
 * already public — every fetcher behind it is anonymous — but nothing on this
 * page linked to it, which came to the same thing.
 *
 * This is the *browsing* path only. `/shows/[id]/live`, `/schedule` and
 * `/results` stay open to everyone, because those are the at-the-rail screens
 * people reach by QR code during a show without signing in.
 */

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: '#e8d5b7' }}
    >
      <div className="text-sm font-medium sm:w-40 shrink-0" style={{ color: '#8b7355' }}>{label}</div>
      <div className="text-sm" style={{ color: '#2c1810' }}>{children}</div>
    </div>
  );
}

export default function VisitorShowView({ showId, show }: { showId: string; show: any }) {
  const registrationOpen = show.status === 'PUBLISHED';
  // Land them back on this show's registration once they have an account,
  // rather than on the home page having forgotten why they signed up. The
  // show's `/register` is the whole flow in order — profile, then stalls, then
  // classes — which is where a brand new account has to start.
  const registerHref = `/register?next=${encodeURIComponent(`/shows/${showId}/register`)}`;
  const signInHref = `/login?next=${encodeURIComponent(`/shows/${showId}/register`)}`;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Shows
      </Link>

      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: '#d4b896' }}>
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.venue && <>📍 {show.venue} &nbsp;·&nbsp; </>}
          📅 {show.start_date} – {show.end_date}
        </p>
        {show.affiliations?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {show.affiliations.map((a: any) => (
              <span
                key={a.show_type_id}
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                title={a.show_type_name}
              >
                {a.show_type_code}
              </span>
            ))}
            <span className="text-xs self-center" style={{ color: '#8b7355' }}>
              points eligible in select classes
            </span>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Event Details</h2>
      <div className="rounded-lg border px-4" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
        <Row label="Show name">{show.name}</Row>
        {show.venue && <Row label="Venue">📍 {show.venue}</Row>}
        <Row label="Dates">{formatDate(show.start_date)} – {formatDate(show.end_date)}</Row>
        <Row label="Status">
          {registrationOpen ? 'Open for registration' : show.status === 'ACTIVE' ? 'In progress' : show.status}
        </Row>
        {show.show_type_code && (
          <Row label="Show type">
            {show.show_type_name ? `${show.show_type_name} (${show.show_type_code})` : show.show_type_code}
          </Row>
        )}
        {show.apha_show_number && <Row label="APHA show #">{show.apha_show_number}</Row>}
        {show.aqha_show_number && <Row label="AQHA show #">{show.aqha_show_number}</Row>}
      </div>

      {/* Ahead of the register/contact pair on purpose: the fee schedule, the
          judges and the class list are what somebody reads in order to decide
          whether to press Register at all. */}
      <Link
        href={`/shows/${showId}/details`}
        className="mt-6 block rounded-lg border p-4 transition hover:bg-amber-50"
        style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
      >
        <div className="font-semibold" style={{ color: '#2c1810' }}>
          Show details &amp; show bill →
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
          Judges, the class schedule, and the full fee schedule. No account needed.
        </div>
      </Link>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {registrationOpen ? (
          <Link
            href={registerHref}
            className="rounded-lg border p-4 text-center transition hover:opacity-90"
            style={{ backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }}
          >
            <div className="font-semibold">Register for this show</div>
            <div className="text-xs mt-0.5" style={{ color: '#f0e8d8' }}>
              You&apos;ll create an account first
            </div>
          </Link>
        ) : (
          // Not a dead button: the show simply isn't taking online entries, and
          // saying so beats a disabled control they have to hover to understand.
          <div
            className="rounded-lg border p-4 text-center"
            style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#8b7355' }}
          >
            <div className="font-semibold" style={{ color: '#5d4a37' }}>Registration is closed</div>
            <div className="text-xs mt-0.5">Message the show office to ask about entries</div>
          </div>
        )}

        <Link
          href={`/shows/${showId}/contact`}
          className="rounded-lg border p-4 text-center transition hover:bg-amber-50"
          style={{ backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#5c3d1e' }}
        >
          <div className="font-semibold">Contact show staff</div>
          <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            Ask a question — no account needed
          </div>
        </Link>
      </div>

      <p className="text-sm mt-4 text-center" style={{ color: '#8b7355' }}>
        Already have an account?{' '}
        <Link href={signInHref} className="font-medium hover:underline" style={{ color: '#8b4513' }}>
          Sign in
        </Link>
      </p>
    </main>
  );
}
