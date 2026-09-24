import { auth } from '@/auth';
import { redirect } from 'next/navigation';

/**
 * GaitDesk admin only. A company's switches stand for a payment the app does
 * not take, so nobody who could benefit from one may set it.
 */
export default async function AdminCompaniesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if ((session.user as { role?: string }).role !== 'ADMIN') redirect('/admin');
  return <>{children}</>;
}
