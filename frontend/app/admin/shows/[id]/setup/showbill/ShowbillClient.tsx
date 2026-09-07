'use client';

import { useRef, useState } from 'react';
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
 * Both presses live on the option they belong to. The upload used to be a
 * section of its own below the choice — a heading, a paragraph of accepted
 * formats, a file input and a file card — for what is one button and, once
 * there is a file, one line about it. Everything that section said is still
 * said: the formats are the button's tooltip, and the file's name, size, date
 * and whether it is published sit under the option it publishes.
 *
 * The radio for the uploaded bill is disabled until a file exists, with a
 * `title` saying why. That is an affordance, not the enforcement: `PUT
 * /shows/{id}/showbill-source` 422s the same case regardless, because a screen
 * that is the only thing stopping a bad write is one an API client walks
 * straight past.
 */

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const UPLOAD_HINT =
  'A PDF, or a JPEG, PNG or WebP image. 10 MB at most. One per show — uploading again replaces it.';

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
  const fileInput = useRef<HTMLInputElement>(null);

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
          : 'The Show Bill button now opens the show bill GaitDesk generates.',
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
          : 'Show bill uploaded. Choose it to publish it in place of the generated one.',
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
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
        >
          {successMsg}
        </div>
      )}

      {/* One file input for the whole screen, driven by the Upload button on
          the option it belongs to. Hidden rather than styled: a bare file
          input cannot say "Upload" or carry the format hint. */}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input so choosing the same file twice still fires.
          e.target.value = '';
          if (file) void upload(file);
        }}
      />

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

        <div className="flex gap-3 items-start justify-between flex-wrap">
          <label className="flex gap-3 items-start cursor-pointer flex-1 min-w-[16rem]">
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
                Showbill generated by GaitDesk
              </span>
              <span className="text-xs block mt-0.5" style={{ color: COLORS.muted }}>
                Drawn from this show&rsquo;s judges, classes, fees and policies, so it updates
                itself every time you change one of them.
                {classCount === 0 && ' No classes on the schedule yet, so it is nearly empty.'}
              </span>
            </span>
          </label>
          {/* The preview sits on the option it previews. It opens whichever
              bill is published, so on the other option it would be describing
              the file above it — which is what the footnote it replaced, at the
              foot of the page and belonging to neither, could never make
              clear. */}
          <a
            href={`/shows/${showId}/showbill`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm rounded px-3 py-2 border whitespace-nowrap"
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
          >
            Preview the show bill as exhibitors will see it
          </a>
        </div>

        <div className="flex gap-3 items-start justify-between flex-wrap">
          <label
            className={`flex gap-3 items-start flex-1 min-w-[16rem] ${doc ? 'cursor-pointer' : 'cursor-not-allowed'}`}
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
              {doc && (
                <span className="text-xs block mt-1" style={{ color: COLORS.muted }}>
                  <strong style={{ color: COLORS.text }}>{doc.original_filename}</strong>{' '}
                  · {formatBytes(doc.file_size)}
                  {formatUploaded(doc.created_at)
                    ? ` · uploaded ${formatUploaded(doc.created_at)}`
                    : ''}
                  {source === 'uploaded' ? ' · published' : ' · on file, not published'} ·{' '}
                  <a
                    href={fileHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: COLORS.warn }}
                  >
                    View
                  </a>
                  {/* Inline confirmation, not a modal — the repo's delete pattern. */}
                  {confirmRemove ? (
                    <>
                      {' '}·{' '}
                      <button
                        type="button"
                        onClick={removeDocument}
                        disabled={busy}
                        className="underline disabled:opacity-50"
                        style={{ color: 'var(--error-strong)' }}
                      >
                        {busy ? 'Removing…' : 'Remove — back to the generated bill'}
                      </button>{' '}
                      ·{' '}
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(false)}
                        disabled={busy}
                        className="underline disabled:opacity-50"
                        style={{ color: COLORS.muted }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {' '}·{' '}
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(true)}
                        disabled={busy}
                        className="underline disabled:opacity-50"
                        style={{ color: 'var(--error-strong)' }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </span>
              )}
            </span>
          </label>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            title={UPLOAD_HINT}
            className="text-sm rounded px-3 py-2 border whitespace-nowrap disabled:opacity-50"
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
          >
            {busy ? 'Working…' : doc ? 'Replace' : 'Upload'}
          </button>
        </div>

        <div
          className="rounded border px-3 py-2 text-xs"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft, color: COLORS.warn }}
        >
          Whichever you choose, the class schedule and the fee list stay on Show Details —
          they are what this app charges from, and an uploaded show bill does not change
          what an exhibitor is billed.
        </div>
      </section>
    </div>
  );
}
