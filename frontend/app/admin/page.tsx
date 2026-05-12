import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

const adminTiles = [
  { href: '/admin/shows', title: 'Shows', description: 'Create, edit, and manage horse shows, classes, and entries.', icon: 'T' },
  { href: '/admin/venues', title: 'Venues', description: 'Add and update venues where shows are held.', icon: 'V' },
  { href: '/admin/horses', title: 'Horses', description: 'Add and edit horses in the system.', icon: 'H' },
  { href: '/admin/trainers', title: 'Trainers', description: 'Manage trainer registry records used on horse profiles.', icon: 'R' },
  { href: '/admin/users', title: 'Users', description: 'Create users, assign roles, and manage Show Secretaries and Scorekeepers.', icon: 'U' },
];

const showAdminTiles = [
  { href: '/admin/shows', title: 'My Shows', description: 'Create and manage the shows you own.', icon: 'T' },
];

export default async function AdminPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user) redirect('/login');
  if (role !== 'ADMIN' && role !== 'SHOW_SECRETARY') redirect('/');

  const tiles = role === 'SHOW_SECRETARY' ? showAdminTiles : adminTiles;

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#2c1810' }}>{role === 'SHOW_SECRETARY' ? 'Show Secretary' : 'Admin'}</h1>
        <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>Back to Shows</Link>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="block p-6 rounded-lg border transition-colors hover:bg-amber-50" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>{tile.title}</h2>
                <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{tile.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
