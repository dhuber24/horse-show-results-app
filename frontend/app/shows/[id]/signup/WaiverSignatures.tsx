'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The entry blank and liability release, signed in the app.
 *
 * Typing your name is the signature — there is nothing for the app to read it
 * off, which is what makes this different from every other check the show
 * office runs. Anyone who would rather sign a paper blank at the counter still
 * can; staff record it at the desk and it lands in the same place.
 *
 * Shown only once sign-up is complete, because signing is scoped to people on
 * the show's roster and the roster row is what sign-up creates.
 */

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  accent: '#8b4513',
  border: '#d4b896',
  borderSoft: '#e8d5b7',
} as const;

type Signature = {
  id: string;
  signed_name: string;
  signed_by_guardian: boolean;
  guardian_relationship: string | null;
  signed_at: string;
  on_paper: boolean;
  recorded_by_name: string | null;
};

type Waiver = {
  id: string;
  title: string;
  body: string;
  is_required: boolean;
  sort_order: number;
  signature: Signature | null;
};

export default function WaiverSignatures({
  showId,
  exhibitorName,
}: {
  showId: string;
  exhibitorName: string;
}) {
  const router = useRouter();
  const [waivers, setWaivers] = useState<Waiver[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState(exhibitorName);
  const [byGuardian, setByGuardian] = useState(false);
  const [relationship, setRelationship] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/shows/${showId}/waivers`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setWaivers(Array.isArray(rows) ? rows : []))
      .catch(() => setWaivers([]));
  };

  useEffect(load, [showId]);

  const startSigning = (waiverId: string) => {
    setOpenId(waiverId);
    setTypedName(exhibitorName);
    setByGuardian(false);
    setRelationship('');
    setAgreed(false);
    setError(null);
  };

  const sign = async (waiverId: string) => {
    if (!typedName.trim() || !agreed) return;
    setBusyId(waiverId);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/waivers/${waiverId}/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signed_name: typedName.trim(),
          signed_by_guardian: byGuardian,
          guardian_relationship: byGuardian ? relationship.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.detail === 'string'
            ? body.detail
            : body?.detail?.message || 'Could not save your signature.',
        );
        return;
      }
      setOpenId(null);
      load();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (waivers === null || waivers.length === 0) return null;

  const outstanding = waivers.filter((w) => w.is_required && !w.signature).length;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
        Entry blank &amp; releases
      </h2>
      <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
        {outstanding === 0
          ? 'Everything this show asks for is signed.'
          : `${outstanding} still to sign. You can also sign a paper copy at the show office.`}
      </p>

      {error && (
        <p
          className="mt-3 text-sm px-3 py-2 rounded border"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}
        >
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {waivers.map((waiver) => {
          const signing = openId === waiver.id;
          return (
            <li
              key={waiver.id}
              className="rounded-lg border p-3"
              style={{ borderColor: COLORS.border, backgroundColor: '#ffffff' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium" style={{ color: COLORS.text }}>
                    {waiver.title}
                    {!waiver.is_required && (
                      <span className="ml-2 text-xs font-normal" style={{ color: COLORS.muted }}>
                        optional
                      </span>
                    )}
                  </p>
                  {waiver.signature && (
                    <p className="text-xs mt-0.5" style={{ color: '#065f46' }} suppressHydrationWarning>
                      ✓ Signed
                      {waiver.signature.signed_by_guardian ? ' by guardian' : ''}
                      {' — '}
                      {waiver.signature.signed_name}
                      {waiver.signature.on_paper ? ' (on paper at the show office)' : ''}
                    </p>
                  )}
                </div>
                {!waiver.signature && !signing && (
                  <button
                    type="button"
                    onClick={() => startSigning(waiver.id)}
                    className="text-sm font-medium px-3 py-1.5 rounded text-white shrink-0"
                    style={{ backgroundColor: COLORS.accent }}
                  >
                    Read &amp; sign
                  </button>
                )}
              </div>

              {signing && (
                <div className="mt-3 space-y-3">
                  <div
                    className="rounded border p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto"
                    style={{ borderColor: COLORS.borderSoft, backgroundColor: '#faf7f2', color: COLORS.text }}
                  >
                    {waiver.body}
                  </div>

                  <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={byGuardian}
                      onChange={(e) => setByGuardian(e.target.checked)}
                    />
                    I am a parent or guardian signing for a minor
                  </label>
                  {byGuardian && (
                    <input
                      value={relationship}
                      onChange={(e) => setRelationship(e.target.value)}
                      placeholder="Relationship (mother, father, guardian…)"
                      className="w-full border rounded px-2 py-1.5 text-sm"
                      style={{ borderColor: COLORS.border }}
                    />
                  )}

                  <label className="block">
                    <span className="text-sm" style={{ color: COLORS.text }}>
                      Type {byGuardian ? 'your' : 'your'} full name to sign
                    </span>
                    <input
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                      style={{ borderColor: COLORS.border }}
                    />
                  </label>

                  <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    I have read the above and agree to it.
                  </label>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => sign(waiver.id)}
                      disabled={busyId === waiver.id || !typedName.trim() || !agreed}
                      title={
                        !agreed
                          ? 'Tick the box to confirm you have read it'
                          : !typedName.trim()
                            ? 'Type your name to sign'
                            : undefined
                      }
                      className="text-sm font-medium px-4 py-2 rounded text-white disabled:opacity-50"
                      style={{ backgroundColor: COLORS.accent }}
                    >
                      {busyId === waiver.id ? 'Signing…' : 'Sign'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="text-sm hover:underline"
                      style={{ color: COLORS.muted }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
