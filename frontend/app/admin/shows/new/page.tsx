import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { fetchVenues, fetchShowTypes } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper from '../_wizard/WizardStepper';
import Step1Client, { type ExistingSecretary } from './Step1Client';

async function fetchSecretaries(): Promise<ExistingSecretary[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/users/by-role?role=SHOW_SECRETARY`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function NewShowPage() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const role = user?.role;
  const callerUserId = user?.id ?? null;
  if (!role || !['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
    redirect('/admin');
  }

  const [venues, showTypes, secretaries] = await Promise.all([
    fetchVenues(),
    fetchShowTypes(),
    fetchSecretaries(),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: 'New Show' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          New Show
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Step 1 of 5: basic show information and Show Secretary.
        </p>
      </div>

      <WizardStepper
        current="basic"
        steps={[
          { key: 'basic', label: '1. Basics', href: null, done: false },
          { key: 'judges', label: '2. Judges', href: null, done: false },
          { key: 'sanctioning', label: '3. Sanctioning', href: null, done: false },
          { key: 'lodging', label: '4. Lodging', href: null, done: false },
          { key: 'fees', label: '5. Fees', href: null, done: false },
        ]}
      />

      <Step1Client
        callerRole={role}
        callerUserId={callerUserId}
        venues={venues}
        showTypes={showTypes}
        secretaries={secretaries}
      />
    </main>
  );
}
