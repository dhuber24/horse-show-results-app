import { auth } from '@/auth';
import { redirect } from 'next/navigation';

/** GaitDesk admin only: what everybody pays, and who pays nothing. */
export default async function AdminSubscriptionsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/admin');
  return <>{children}</>;
}
