import Link from 'next/link';

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  PUBLISHED: { label: 'Open for Registration', bg: '#fef3c7', text: '#92400e' },
  ACTIVE: { label: 'In Progress', bg: '#d1fae5', text: '#065f46' },
  COMPLETED: { label: 'Completed', bg: '#dbeafe', text: '#1e40af' },
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

interface Affiliation {
  show_type_id: string;
  show_type_code: string;
  show_type_name?: string;
}

interface Show {
  name: string;
  venue?: string | null;
  start_date: string;
  end_date: string;
  status: string;
  affiliations?: Affiliation[];
}

export default function ShowHubHeader({
  show,
  backHref,
  backLabel,
}: {
  show: Show;
  backHref: string;
  backLabel: string;
}) {
  const badge = STATUS_BADGE[show.status];
  return (
    <div className="mb-6">
      <Link href={backHref} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← {backLabel}
      </Link>
      <div className="mt-4 pb-4 border-b" style={{ borderColor: '#d4b896' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
          {badge && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: badge.bg, color: badge.text }}>
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.venue ? <>📍 {show.venue} &nbsp;·&nbsp; </> : null}
          📅 {formatDate(show.start_date)} – {formatDate(show.end_date)}
        </p>
        {show.affiliations && show.affiliations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {show.affiliations.map((a) => (
              <span
                key={a.show_type_id}
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                title={a.show_type_name}
              >
                {a.show_type_code}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
