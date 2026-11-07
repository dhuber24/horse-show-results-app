'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';
import {
  MAP_KINDS,
  mapFileHref,
  type MapKind,
  type ShowMapDocument,
  type ShowMaps,
} from '@/lib/show-maps';

/**
 * The show's stall map and RV / camping map (migration 182).
 *
 * Each upload is written the moment the file is chosen, not held for the step's
 * Save: a file is not a value the autosave can compare against what loaded,
 * and a manager who picked a map and walked on would expect it to be there.
 * Removing one asks inline first — the repo's delete pattern.
 */

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const UPLOAD_HINT =
  'A PDF, or a JPEG, PNG or WebP image. 10 MB at most. Uploading again replaces it.';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ShowMapsCard({
  showId,
  initialMaps,
}: {
  showId: string;
  initialMaps: ShowMaps;
}) {
  const router = useRouter();
  const [maps, setMaps] = useState<ShowMaps>(initialMaps);
  const [busy, setBusy] = useState<MapKind | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MapKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<MapKind, HTMLInputElement | null>>>({});

  async function upload(kind: MapKind, file: File) {
    setBusy(kind);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/shows/${showId}/maps/${kind}`, { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(json, 'Could not upload that map.'));
        return;
      }
      setMaps(json as ShowMaps);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: MapKind) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/maps/${kind}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(json, 'Could not remove that map.'));
        return;
      }
      setMaps(json as ShowMaps);
      setConfirmRemove(null);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      aria-labelledby="maps-heading"
    >
      <div>
        <h2 id="maps-heading" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          Maps
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          Where the barns and the RV spots are. Exhibitors open them from Show Details as soon
          as they are uploaded. Both optional.
        </p>
      </div>

      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {MAP_KINDS.map(({ kind, label }) => {
          const doc: ShowMapDocument | null = maps[kind];
          const working = busy === kind;
          return (
            <li key={kind} className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {label}
                </div>
                <div className="text-xs mt-0.5 break-words" style={{ color: 'var(--muted)' }}>
                  {doc ? (
                    <>
                      <strong style={{ color: 'var(--foreground)' }}>{doc.original_filename}</strong>{' '}
                      · {formatBytes(doc.file_size)} ·{' '}
                      <a
                        href={mapFileHref(showId, kind)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                        style={{ color: 'var(--text-deep)' }}
                      >
                        View
                      </a>{' '}
                      ·{' '}
                      {confirmRemove === kind ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void remove(kind)}
                            disabled={working}
                            className="underline disabled:opacity-50"
                            style={{ color: 'var(--error-strong)' }}
                          >
                            {working ? 'Removing…' : 'Remove it'}
                          </button>{' '}
                          ·{' '}
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(null)}
                            disabled={working}
                            className="underline disabled:opacity-50"
                            style={{ color: 'var(--muted)' }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(kind)}
                          disabled={busy !== null}
                          title={busy !== null ? 'Wait for the upload to finish.' : undefined}
                          className="underline disabled:opacity-50"
                          style={{ color: 'var(--error-strong)' }}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  ) : (
                    'None uploaded.'
                  )}
                </div>
              </div>
              <input
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-label={`Upload the ${label.toLowerCase()}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = '';
                  if (file) void upload(kind, file);
                }}
              />
              <button
                type="button"
                onClick={() => inputs.current[kind]?.click()}
                disabled={busy !== null}
                title={busy !== null ? 'Wait for the upload to finish.' : UPLOAD_HINT}
                className="text-sm rounded px-3 py-2 border whitespace-nowrap disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
              >
                {working ? 'Working…' : doc ? 'Replace' : 'Upload'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
