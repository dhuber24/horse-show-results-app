import { fetchShow } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: '#e8d5b7' }}>
      <div className="text-sm font-medium sm:w-40 shrink-0" style={{ color: '#8b7355' }}>{label}</div>
      <div className="text-sm" style={{ color: '#2c1810' }}>{children}</div>
    </div>
  );
}

export default async function ShowDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}/live`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Show Details</h2>

      <div className="rounded-lg border px-4" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
        <Row label="Show name">{show.name}</Row>
        {show.venue && <Row label="Venue">📍 {show.venue}</Row>}
        <Row label="Dates">{formatDate(show.start_date)} – {formatDate(show.end_date)}</Row>
        <Row label="Status">{show.status}</Row>
        {show.show_type_code && (
          <Row label="Show type">
            {show.show_type_name ? `${show.show_type_name} (${show.show_type_code})` : show.show_type_code}
          </Row>
        )}
        {show.affiliations && show.affiliations.length > 0 && (
          <Row label="Affiliations">
            <div className="flex flex-wrap gap-1.5">
              {show.affiliations.map((a: any) => (
                <span key={a.show_type_id}
                  className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                  title={a.show_type_name}>
                  {a.show_type_code}
                </span>
              ))}
            </div>
          </Row>
        )}
        {show.apha_show_number && <Row label="APHA show #">{show.apha_show_number}</Row>}
        {show.aqha_show_number && <Row label="AQHA show #">{show.aqha_show_number}</Row>}
      </div>
    </main>
  );
}
