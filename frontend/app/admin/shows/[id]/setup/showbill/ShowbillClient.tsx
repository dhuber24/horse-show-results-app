'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Choosing which show bill this show publishes, and putting a file on record.
 *
 * The two are separate presses on purpose, mirroring the two endpoints behind
 * them. Uploading a bill does not switch the show over to it — a manager
 * comparing their club's PDF against the generated bill has to be able to look
 * at it without every exhibitor's Show Bill button changing underneath them
 * mid-comparison. Choosing "the one we uploaded" is the second press.
 *
 * The radio for the uploaded bill is disabled until a file exists, with a
 * `title` saying why. That is an affordance, not the enforcement: `PUT
 * /shows/{id}/showbill-source` 422s the same case regardless, because a screen
 * that is the only thing stopping a bad write is one an API client walks
 * straight past.
 */

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export type ShowbillDocument = {
  id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

type Source = 'generated' | 'uploaded';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploaded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ShowbillClient({
  showId,
  classCount,
  initialSource,
  initialDocument,
}: {
  showId: string;
  classCount: number;
  initialSource: Source;
  initialDocument: ShowbillDocument | null;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>(initialSource);
  const [doc, setDoc] = useState<ShowbillDocument | null>(initialDocument);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const fileHref = `/api/shows/${showId}/showbill-document/file`;

  async function chooseSource(next: Source) {
    if (next === source) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/shows/${showId}/showbill-source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Could not change which show bill this show publishes.');
        return;
      }
      setSource(json.source);
      setSuccessMsg(
        json.effective_source === 'uploaded'
          ? 'The Show Bill button now opens your uploaded show bill.'
          : 'The Show Bill button now opens the show bill this app builds.',
      );
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/shows/${showId}/showbill-document`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Could not upload that show bill.');
        return;
      }
      setDoc(json.document);
      setSource(json.source);
      setSuccessMsg(
        json.effective_source === 'uploaded'
          ? 'Show bill replaced.'
          : 'Show bill uploaded. Choose it below to publish it in place of the generated one.',
      );
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument() {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/shows/${showId}/showbill-document`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.detail || 'Could not remove that show bill.');
        return;
      }
      setDoc(null);
      // The backend puts the show back on the generated bill in the same
      // transaction — read the source it returns rather than assuming.
      setSource(json.source);
      setConfirmRemove(false);
      setSuccessMsg('Uploaded show bill removed. This show is back on the generated one.');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const noFileReason = 'Upload a show bill first — there is nothing to publish yet.';

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {successMsg}
        </div>
      )}

      <section
        className="p-4 rounded-lg border space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Which show bill do exhibitors see?
          </h2>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            This is what opens from the Show Bill button, on the show page and at the rail.
          </p>
        </div>

        <label className="flex gap-3 items-start cursor-pointer">
          <input
            type="radio"
            name="showbill-source"
            className="mt-1"
            checked={source === 'generated'}
            disabled={busy}
            onChange={() => chooseSource('generated')}
          />
          <span>
            <span className="text-sm font-medium block" style={{ color: COLORS.text }}>
              The show bill this app builds
            </span>
            <span className="text-xs block mt-0.5" style={{ color: COLORS.muted }}>
              Drawn from this show&rsquo;s judges, classes, fees and policies, so it updates
              itself every time you change one of them.
              {classCount === 0 && ' No classes on the schedule yet, so it is nearly empty.'}
            </span>
          </span>
        </label>

        <label
          className={`flex gap-3 items-start ${doc ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          title={doc ? undefined : noFileReason}
        >
          <input
            type="radio"
            name="showbill-source"
            className="mt-1"
            checked={source === 'uploaded'}
            disabled={busy || !doc}
            onChange={() => chooseSource('uploaded')}
          />
          <span>
            <span className="text-sm font-medium block" style={{ color: COLORS.text }}>
              Our own show bill, uploaded
            </span>
            <span className="text-xs block mt-0.5" style={{ color: COLORS.muted }}>
              {doc
                ? 'Published as you supplied it. It will not update when you change classes or fees — replace the file when the show bill changes.'
                : noFileReason}
            </span>
          </span>
        </label>

        <div
          className="rounded border px-3 py-2 text-xs"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
        >
          Whichever you choose, the class schedule and the fee list stay on Show Details —
          they are what this app charges from, and an uploaded show bill does not change
          what an exhibitor is billed.
        </div>
      </section>

      <section
        className="p-4 rounded-lg border space-y-4"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
            Your own show bill
          </h2>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            A PDF, or a JPEG, PNG or WebP image. 10 MB at most. One per show — uploading
            again replaces it.
          </p>
        </div>

        {doc ? (
          <div
            className="rounded border p-3 flex flex-wrap items-center justify-between gap-3"
            style={{ borderColor: COLORS.border }}
          >
            <div>
              <div className="text-sm font-medium" style={{ color: COLORS.text }}>
                {doc.original_filename}
              </div>
              <div className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                {formatBytes(doc.file_size)}
                {formatUploaded(doc.created_at) ? ` · uploaded ${formatUploaded(doc.created_at)}` : ''}
                {source === 'uploaded' ? ' · published' : ' · on file, not published'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={fileHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm rounded px-3 py-2 border"
                style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
              >
                View
              </a>
              {/* Inline confirmation, not a modal — the repo's delete pattern. */}
              {confirmRemove ? (
                <>
                  <button
                    type="button"
                    onClick={removeDocument}
                    disabled={busy}
                    className="text-sm rounded px-3 py-2 disabled:opacity-50"
                    style={{ backgroundColor: '#c0392b', color: '#fff' }}
                  >
                    {busy ? 'Removing…' : 'Remove — back to the generated bill'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={busy}
                    className="text-sm rounded px-3 py-2 border disabled:opacity-50"
                    style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy}
                  className="text-sm rounded px-3 py-2 border disabled:opacity-50"
                  style={{ borderColor: COLORS.border, color: '#922', backgroundColor: '#fff' }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            Nothing on file. This show publishes the show bill the app builds.
          </p>
        )}

        <label className="block">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            {doc ? 'Replace it' : 'Upload a show bill'}
          </span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Clear the input so choosing the same file twice still fires.
              e.target.value = '';
              if (file) void upload(file);
            }}
            className="block w-full text-sm"
            style={{ color: COLORS.text }}
          />
        </label>
      </section>

      <p className="text-xs" style={{ color: COLORS.muted }}>
        <a
          href={`/shows/${showId}/showbill`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: COLORS.warn }}
        >
          Open the show bill as exhibitors see it
        </a>{' '}
        — it opens whichever one is published above.
      </p>
    </div>
  );
}
