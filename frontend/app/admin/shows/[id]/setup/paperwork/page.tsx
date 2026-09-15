import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import PaperworkClient, {
  type Waiver,
} from '../../desk/paperwork/PaperworkClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

/**
 * What this show requires of an exhibitor: which health papers a horse arrives
 * with, and what the rider signs.
 *
 * This route was a redirect to the desk's copy, because the answer is the
 * desk's standing order — read every time somebody registers, and revised by
 * the people working registration. That reasoning still holds and the desk
 * screen stays. What it got wrong is that the *first* answer is given while the
 * show is being built: a manager setting up a show is asking "what do I require
 * of an exhibitor?" at that moment, and nothing in the wizard asked it. So it is
 * a step as well, rendering the same `PaperworkClient` against the same
 * endpoints — one screen with two doors, not a second implementation that can
 * disagree with the first.
 *
 * It sits before the Show Bill because the bill prints these requirements, the
 * same reason Sanctioning and Futurities come before Fees.
 */
export default async function SetupPaperworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [waivers, stepsInput] = await Promise.all([
    fetchAuthed<Waiver[]>(`${API_URL}/shows/${id}/waivers`, []),
    fetchStepCounts(id),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="paperwork"
      title="Step 9: Paperwork Requirements"
      subtitle="Which health documents a horse must arrive with, and what the exhibitor signs. Only what you turn on here is asked for at registration or checked at the desk."
      stepsInput={stepsInput}
    >
      <PaperworkClient
        showId={id}
        initialRequirements={{
          requires_coggins: show.requires_coggins ?? true,
          requires_health_certificate: show.requires_health_certificate ?? false,
          health_certificate_valid_days: show.health_certificate_valid_days ?? 30,
          requires_vaccination: show.requires_vaccination ?? false,
          vaccination_valid_days: show.vaccination_valid_days ?? 365,
          vaccination_notes: show.vaccination_notes ?? null,
        }}
        initialWaivers={waivers}
      />

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        The registration desk reads this every time somebody signs up, and staff
        can revise it there without coming back through setup —{' '}
        <Link
          href={`/admin/shows/${id}/desk/paperwork`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Paperwork at the registration desk
        </Link>
        .
      </p>
    </StepLayout>
  );
}
