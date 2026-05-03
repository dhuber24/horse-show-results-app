import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ShowRequestForm from './ShowRequestForm';

export default async function NewShowRequestPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'SHOW_MANAGER') redirect('/');

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: '#faf7f2' }}>
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <Link
            href="/show-requests"
            className="text-sm hover:underline"
            style={{ color: '#8b4513' }}
          >
            ← Back to My Show Requests
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Submit Show Request</h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Request to host a sanctioned horse show. An admin will review and approve your
            request, after which your show will be created automatically.
          </p>
        </div>

        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <ShowRequestForm />
        </div>
      </div>
    </main>
  );
}
