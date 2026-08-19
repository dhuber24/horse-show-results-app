'use client';

import { useState } from 'react';
import { COLORS } from './types';
import type { WaiverCheck } from './types';

/**
 * One waiver at the desk, and the two ways it gets signed.
 *
 * A signature is not a verification. Every other sign-off on this screen reads
 * its value off a record so a caller cannot attest to something nobody has on
 * file — but there is nothing to read a signature from, and nothing for it to
 * go stale against. It is either there or it is not.
 *
 * Staff type the name off the paper blank. That is the whole point: a show
 * running on clipboards still needs its outstanding count to work, and the
 * alternative is an office that knows who signed electronically and has no idea
 * about everyone else.
 */

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function WaiverRow({
  waiver,
  busy,
  onRecord,
  onUndo,
}: {
  waiver: WaiverCheck;
  busy: boolean;
  onRecord: (body: {
    signed_name: string;
    signed_by_guardian: boolean;
    guardian_relationship: string | null;
  }) => Promise<void>;
  onUndo: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [byGuardian, setByGuardian] = useState(false);
  const [relationship, setRelationship] = useState('');

  const signed = waiver.status === 'signed';

  const submit = async () => {
    if (!signedName.trim()) return;
    await onRecord({
      signed_name: signedName.trim(),
      signed_by_guardian: byGuardian,
      guardian_relationship: byGuardian ? relationship.trim() || null : null,
    });
    setRecording(false);
    setSignedName('');
    setByGuardian(false);
    setRelationship('');
  };

  return (
    <div className="py-2 border-t first:border-t-0" style={{ borderColor: '#f0e6d6' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm" style={{ color: COLORS.text }}>
            <span className="font-medium">{waiver.title}</span>
            {!waiver.is_required && (
              <span className="ml-2 text-xs" style={{ color: COLORS.muted }}>optional</span>
            )}
          </div>
          {signed && (
            <p className="text-xs mt-0.5" style={{ color: COLORS.muted }} suppressHydrationWarning>
              {waiver.signed_by_guardian ? 'Guardian ' : ''}
              {waiver.signed_name}
              {waiver.signed_by_guardian && waiver.guardian_relationship
                ? ` (${waiver.guardian_relationship})`
                : ''}
              {waiver.signed_at ? ` · ${formatWhen(waiver.signed_at)}` : ''}
              {waiver.on_paper
                ? ` · on paper${waiver.recorded_by_name ? `, recorded by ${waiver.recorded_by_name}` : ''}`
                : ' · signed in the app'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
            style={
              signed
                ? { backgroundColor: '#d1fae5', color: '#065f46' }
                : { backgroundColor: '#f5ede0', color: '#8b4513' }
            }
          >
            {signed ? '✓ Signed' : '○ Not signed'}
          </span>
          {signed ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              title="Remove this signature — use when it was recorded against the wrong person"
              className="text-xs hover:underline disabled:opacity-50"
              style={{ color: COLORS.muted }}
            >
              Undo
            </button>
          ) : (
            !recording && (
              <button
                type="button"
                onClick={() => setRecording(true)}
                className="text-xs font-medium px-2.5 py-1 rounded text-white"
                style={{ backgroundColor: '#8b4513' }}
              >
                Record paper signature
              </button>
            )
          )}
        </div>
      </div>

      {recording && !signed && (
        <div className="mt-2 rounded border p-2 space-y-2" style={{ borderColor: COLORS.borderSoft, backgroundColor: '#fffdf9' }}>
          <label className="block">
            <span className="text-xs" style={{ color: COLORS.muted }}>Name as signed on the blank</span>
            <input
              value={signedName}
              onChange={(e) => setSignedName(e.target.value)}
              className="mt-0.5 w-full border rounded px-2 py-1 text-sm"
              style={{ borderColor: COLORS.border }}
              placeholder="Signature"
            />
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.text }}>
            <input
              type="checkbox"
              checked={byGuardian}
              onChange={(e) => setByGuardian(e.target.checked)}
            />
            A parent or guardian signed for a minor
          </label>
          {byGuardian && (
            <input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm"
              style={{ borderColor: COLORS.border }}
              placeholder="Relationship (mother, father, guardian…)"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !signedName.trim()}
              title={!signedName.trim() ? 'Type the name as it appears on the blank' : undefined}
              className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: '#8b4513' }}
            >
              {busy ? 'Saving…' : 'Save signature'}
            </button>
            <button
              type="button"
              onClick={() => setRecording(false)}
              className="text-xs hover:underline"
              style={{ color: COLORS.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
