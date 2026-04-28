import Link from 'next/link';

interface Crumb {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm mb-1">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span style={{ color: '#d4b896' }} aria-hidden="true">
              ›
            </span>
          )}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:underline" style={{ color: '#8b4513' }}>
              {crumb.label}
            </Link>
          ) : (
            <span style={{ color: '#8b7355' }}>{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
