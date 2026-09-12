import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { fetchVenues, fetchShowTypes } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper from '../_wizard/WizardStepper';
import { buildSteps } from '../_wizard/steps';
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

  // The same list every setup step and the hub draw, read from `buildSteps`
  // rather than typed out here — a hand-written copy fell behind the wizard
  // twice and showed a five-step order that no longer existed. Nothing is
  // linkable or done yet, because the show does not exist until this step saves.
  const steps = buildSteps({
    showId: '',
    judgeCount: 0,
    sanctioningCount: 0,
    lodgingFeeCount: 0,
    feesCount: 0,
    classCount: 0,
    futurityCount: 0,
    scoredClassCount: 0,
    cardedClassCount: 0,
    showbillReady: false,
  }).map((step) => ({ ...step, href: null, done: false }));

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
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          New Show
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Step 1 of {steps.length}: basic show information and Show Secretary.
        </p>
      </div>

      <WizardStepper current="basic" steps={steps} />

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
