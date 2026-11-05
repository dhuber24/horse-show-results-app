'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import type { ShowCompany } from '@/lib/show-companies';
import { companyVerificationLine } from '@/lib/subscriptions';

function useVerification(
  company: ShowCompany,
  onChange: (company: ShowCompany) => void,
  onError: (message: string | null) => void,
) {
  const [busy, setBusy] = useState(false);

  async function send(method: 'POST' | 'DELETE', fallback: string) {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/subscriptions/companies/${company.id}/verify`, { method });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      onError(errorMessage(body, fallback));
      return false;
    }
    onChange(body as ShowCompany);
    return true;
  }

  return {
    busy,
    verify: () => send('POST', `${company.name} could not be verified.`),
    remove: () => send('DELETE', `Verification could not be removed from ${company.name}.`),
  };
}

/** The one click on a company's row. Taking it back is under Manage. */
export function VerifyButton({
  company,
  onChange,
  onError,
}: {
  company: ShowCompany;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const { busy, verify } = useVerification(company, onChange, onError);
  if (company.verified_at) return null;
  return (
    <button
      type="button"
      disabled={busy}
      title={busy ? 'Verifying…' : `Lets ${company.name} reach anybody with a GaitDesk record`}
      onClick={verify}
      className="text-sm font-medium hover:underline text-left sm:text-right disabled:opacity-50"
      style={{ color: 'var(--accent)' }}
    >
      {busy ? 'Verifying…' : 'Verify'}
    </button>
  );
}

/**
 * Whether a company has shown who it is (migration 180), under Manage on its row.
 * Unverified, its office reaches only people who signed up to its shows or whom it
 * typed in; see `backend/company_verification.py`.
 */
export default function CompanyVerification({
  company,
  onChange,
  onError,
}: {
  company: ShowCompany;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const { busy, verify, remove } = useVerification(company, onChange, onError);
  const [confirming, setConfirming] = useState(false);

  async function takeAway() {
    if (await remove()) setConfirming(false);
  }

  return (
    <div className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Verification</h3>
      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>{companyVerificationLine(company)}</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Until a company is verified, its office reaches only people who signed up to one of its shows or whom it
        typed in itself. Verifying it lets it add anybody with a GaitDesk record, and read their phone, address and
        emergency contact once they are on a show. Its first payment to GaitDesk verifies it too.
      </p>
      {!company.verified_at ? (
        <button
          type="button"
          disabled={busy}
          title={busy ? 'Verifying…' : undefined}
          onClick={verify}
          className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {busy ? 'Verifying…' : `Verify ${company.name}`}
        </button>
      ) : confirming ? (
        <div className="space-y-1">
          <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
            Remove verification? It stops reaching anybody new, and a later payment won&apos;t bring it back. People it
            has already put on a roster stay there.
          </p>
          <span className="flex items-center gap-3 text-sm">
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Removing…' : undefined}
              onClick={takeAway}
              className="font-medium hover:underline disabled:opacity-50"
              style={{ color: 'var(--error-strong)' }}
            >
              Yes, remove it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="hover:underline"
              style={{ color: 'var(--muted)' }}
            >
              Keep it
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-sm hover:underline"
          style={{ color: 'var(--error-strong)' }}
        >
          Remove verification
        </button>
      )}
    </div>
  );
}
