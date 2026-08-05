import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper from '../../_wizard/WizardStepper';
import { buildSteps } from '../../_wizard/steps';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

type FeeRow = { id: string; code: string; label: string; amount_cents: number; unit: string };

const LODGING_CODES = new Set(['stall', 'shavings', 'camping']);
const FEE_CODES = new Set(['standard_class', 'jackpot', 'futurity']);

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default async function SetupHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);

  const [judges, sanctioning, fees] = await Promise.all([
    fetchAuthed<{ id: string }[]>(`${API_URL}/shows/${id}/judges/`, []),
    fetchAuthed<{ association_id: string }[]>(
      `${API_URL}/shows/${id}/sanctioning/`,
      [],
    ),
    fetchAuthed<FeeRow[]>(`${API_URL}/shows/${id}/fees/`, []),
  ]);

  const lodgingFeeCount = fees.filter((f) => LODGING_CODES.has(f.code)).length;
  const otherFeeCount = fees.filter((f) => FEE_CODES.has(f.code)).length;
  const feesDone = otherFeeCount > 0 || (show.office_charge_cents ?? 0) > 0;

  const steps = buildSteps({
    showId: id,
    judgeCount: judges.length,
    sanctioningCount: sanctioning.length,
    lodgingFeeCount,
    feesCount: feesDone ? 1 : 0,
  });

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Setup' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Setup — {show.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          Step through to configure this show. You can skip steps and come back to them later.
        </p>
      </div>

      <WizardStepper current="basic" steps={steps} />

      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href ?? '#'}
              className="block p-4 rounded-lg border transition-colors hover:bg-amber-50"
              style={{
                borderColor: step.done ? '#bcd9c0' : COLORS.border,
                backgroundColor: step.done ? '#f3faf3' : COLORS.bg,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
                    {step.label}
                  </h2>
                  <p className="text-sm mt-0.5" style={{ color: COLORS.muted }}>
                    {stepHint(step.key, {
                      judgeCount: judges.length,
                      sanctioningCount: sanctioning.length,
                      lodgingFeeCount,
                      feesDone,
                    })}
                  </p>
                </div>
                {/* A configured step is still a link, so the badge names what
                    clicking it does rather than restating the green styling. */}
                <span
                  className="text-xs px-2 py-1 rounded shrink-0"
                  style={{
                    color: step.done ? '#1f4e1f' : COLORS.warn,
                    backgroundColor: step.done ? '#dff1df' : COLORS.warnSoft,
                  }}
                >
                  {step.done ? 'Edit' : 'Open'}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function stepHint(
  key: 'basic' | 'judges' | 'sanctioning' | 'lodging' | 'fees',
  ctx: {
    judgeCount: number;
    sanctioningCount: number;
    lodgingFeeCount: number;
    feesDone: boolean;
  },
): string {
  switch (key) {
    case 'basic':
      return 'Name, dates, venue, show secretary.';
    case 'judges':
      return ctx.judgeCount === 0
        ? 'No judges added yet.'
        : `${ctx.judgeCount} judge${ctx.judgeCount === 1 ? '' : 's'} added.`;
    case 'sanctioning':
      return ctx.sanctioningCount === 0
        ? 'No sanctioning associations selected. Skip if none apply.'
        : `${ctx.sanctioningCount} sanctioning association${ctx.sanctioningCount === 1 ? '' : 's'}.`;
    case 'lodging':
      return ctx.lodgingFeeCount === 0
        ? 'Stall, shavings, and camping fees not configured.'
        : `${ctx.lodgingFeeCount} lodging fee${ctx.lodgingFeeCount === 1 ? '' : 's'} configured.`;
    case 'fees':
      return ctx.feesDone
        ? 'Office charge and class fees configured.'
        : 'Office charge, standard class fee, jackpot, and futurity fees.';
  }
}
