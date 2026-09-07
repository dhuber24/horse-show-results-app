import Link from 'next/link';

interface Crumb {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const parentCrumb = [...crumbs].reverse().find(c => c.href);

  return (
    <div className="mb-1">
      {parentCrumb && (
        <Link
          href={parentCrumb.href!}
          className="text-sm hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          ← Back to {parentCrumb.label}
        </Link>
      )}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span style={{ color: 'var(--border)' }} aria-hidden="true">›</span>
            )}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:underline" style={{ color: 'var(--accent)' }}>
                {crumb.label}
              </Link>
            ) : (
              <span>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}
