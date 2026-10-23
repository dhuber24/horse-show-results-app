import Link from 'next/link';

const LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

/**
 * The foot of every page: the Terms of Service and Privacy Policy, which the
 * Terms say every user agrees to, so they are one tap away wherever somebody
 * is. A full-screen Live Board covers it (`board/layout.tsx` is a fixed
 * overlay), so a monitor at the rail never shows it; it is left off printouts.
 */
export default function SiteFooter() {
  return (
    <footer
      className="border-t mt-10 px-4 py-6 text-xs print:hidden"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
    >
      <nav aria-label="Site" className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-center">© {new Date().getFullYear()} GaitDesk</p>
    </footer>
  );
}
