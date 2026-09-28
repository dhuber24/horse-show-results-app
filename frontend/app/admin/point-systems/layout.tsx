import { auth } from '@/auth';
import { redirect } from 'next/navigation';

/**
 * GaitDesk admins, show managers and secretaries. A points system belongs to a
 * show company (migration 148): its people keep the charts their shows score
 * by, and an admin sees every company's.
 */
export default async function AdminPointSystemsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role ?? '';
  if (!['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) redirect('/admin');
  return <>{children}</>;
}
