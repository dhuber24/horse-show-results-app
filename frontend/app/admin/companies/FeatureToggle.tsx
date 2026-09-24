'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { CompanyFeature, ShowCompany } from '@/lib/show-companies';

/**
 * One paid feature's switch for one company, on the list and on the company's
 * own page -- the same control in both places, so it behaves the same.
 *
 * **Immediate in both directions.** Turning a feature off loses nothing: the
 * company's work is kept and comes back when it is turned on again, so an
 * accidental flip costs one more press, and a confirmation on a switch is a
 * switch that does not switch.
 *
 * **The knob moves on the press, and settles on the answer.** A round trip is
 * a second or two, and a switch that sits still that long reads as one that
 * did not take. So it shows where it is going while the request runs, then the
 * parent redraws from the whole company the endpoint returns -- and a refusal
 * puts it back where the backend says it is.
 */
export default function FeatureToggle({
  companyId,
  companyName,
  feature,
  onChange,
  onError,
}: {
  companyId: string;
  companyName: string;
  feature: CompanyFeature;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  // Where the switch is heading while a request is in flight; null otherwise.
  const [pending, setPending] = useState<boolean | null>(null);
  const saving = pending !== null;
  const on = pending ?? feature.enabled;

  async function flip() {
    const target = !feature.enabled;
    setPending(target);
    onError(null);
    const res = await fetch(`/api/show-companies/${companyId}/features/${feature.key}`, {
      method: target ? 'PUT' : 'DELETE',
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (res?.ok) onChange(body as ShowCompany);
    else {
      onError(
        errorMessage(body, `${feature.label} could not be turned ${target ? 'on' : 'off'} for ${companyName}.`),
      );
    }
    setPending(null);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${feature.label} for ${companyName}`}
      onClick={flip}
      disabled={saving}
      title={saving ? 'Saving…' : on ? `On — press to turn off for ${companyName}` : `Off — press to turn on for ${companyName}`}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-wait"
      style={{
        backgroundColor: on ? 'var(--success)' : 'var(--border-strong)',
        borderColor: on ? 'var(--success-strong)' : 'var(--border-strong)',
      }}
    >
      <span
        aria-hidden
        className="inline-block h-5 w-5 rounded-full shadow transition-transform"
        style={{
          backgroundColor: 'var(--surface)',
          transform: on ? 'translateX(1.25rem)' : 'translateX(0.0625rem)',
        }}
      />
    </button>
  );
}
