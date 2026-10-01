import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect('/login');
  if (
    session.user.role !== 'ADMIN' &&
    session.user.role !== 'SHOW_SECRETARY' &&
    session.user.role !== 'SHOW_MANAGER'
  ) redirect('/');

  // On the desktop layout an office page takes the width it is given. Its own
  // `max-w-3xl` (or 5xl, 6xl) is a column sized for a laptop with nothing
  // beside it; beside the sidebar on a desktop it left the Class Builder's
  // matrix and the desk's panel scrolling inside 768px with half the screen
  // empty. One rule here rather than a class on every page, so a new office page
  // is wide on a desktop without anyone remembering to make it so. Phones and
  // tablets keep the caps, and the public pages — which are not under /admin —
  // keep the width the public sees.
  return <div className="desktop:[&_main]:max-w-none">{children}</div>;
}
