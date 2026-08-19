'use client';

import { useEffect, useState } from 'react';
import { COLORS } from './types';

/**
 * The uploaded document, shown beside the sign-off it belongs to.
 *
 * The reason this exists is the exhibitor who left the folder at home. The
 * paper is the thing a secretary inspects — markings and description against
 * the animal in the trailer — and until now, an exhibitor who had uploaded a
 * perfectly good Coggins and forgotten the printout was in the same position as
 * one who had nothing at all. Staff could download the file, but downloading a
 * stranger's veterinary paperwork onto the office laptop to squint at it is not
 * the same thing as looking at it.
 *
 * So: inline, beside the checkbox, and nothing is written to disk. The `view`
 * route serves the same bytes as `download` under the same access rules; only
 * the Content-Disposition differs.
 *
 * PDFs go in an <iframe> and images in an <img> because a browser will render a
 * PDF in a frame and will not render one in an image tag. Anything else gets a
 * download link rather than a broken box — a scan uploaded as a .heic is a real
 * thing that happens.
 */

export interface HorseDocumentSummary {
  id: string;
  document_type: string;
  document_type_label: string | null;
  original_filename: string;
  mime_type: string;
  file_size: number;
  issue_date: string | null;
  expiry_date: string | null;
  created_at: string;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function DocumentViewer({
  horseId,
  horseName,
  documentType,
  title,
  onClose,
}: {
  horseId: string;
  horseName: string;
  /** Which paper to show. The picker below offers the others of the same type. */
  documentType: string;
  title: string;
  onClose: () => void;
}) {
  const [documents, setDocuments] = useState<HorseDocumentSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDocuments(null);
    setError(null);
    fetch(`/api/horses/${horseId}/documents`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: HorseDocumentSummary[]) => {
        if (cancelled) return;
        const matching = (Array.isArray(rows) ? rows : [])
          .filter((d) => d.document_type === documentType)
          // Newest upload first: it is the one the exhibitor most recently
          // thought was current, and the one staff mean by "their Coggins".
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setDocuments(matching);
        setSelectedId(matching[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this horse’s documents.');
      });
    return () => {
      cancelled = true;
    };
  }, [horseId, documentType]);

  const selected = documents?.find((d) => d.id === selectedId) ?? null;
  const src = selected ? `/api/horses/${horseId}/documents/${selected.id}/view` : null;
  const isPdf = selected?.mime_type === 'application/pdf';
  const isImage = selected?.mime_type?.startsWith('image/') ?? false;

  return (
    <div
      className="rounded border overflow-hidden"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.surfaceSoft }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b"
        style={{ borderColor: COLORS.borderSoft }}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: COLORS.accent }}>
            {title}
          </p>
          <p className="text-xs truncate" style={{ color: COLORS.muted }}>
            {horseName}
            {selected ? ` · ${selected.original_filename}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs hover:underline shrink-0"
          style={{ color: COLORS.muted }}
        >
          Close
        </button>
      </div>

      {documents === null && !error && (
        <p className="text-sm p-4" style={{ color: COLORS.muted }}>Loading…</p>
      )}

      {error && <p className="text-sm p-4 text-red-700">{error}</p>}

      {documents !== null && documents.length === 0 && (
        <div className="p-4">
          <p className="text-sm" style={{ color: COLORS.text }}>
            Nothing uploaded for this document.
          </p>
          <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
            Ask for the paper copy. You can still sign off that you inspected it — the app not
            having a scan is not the same as the exhibitor not having the document.
          </p>
        </div>
      )}

      {selected && (
        <>
          {documents && documents.length > 1 && (
            <div className="flex flex-wrap gap-1 px-3 pt-2">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  aria-pressed={doc.id === selectedId}
                  className="text-xs px-2 py-1 rounded border"
                  style={{
                    borderColor: COLORS.border,
                    backgroundColor: doc.id === selectedId ? COLORS.dark : COLORS.surface,
                    color: doc.id === selectedId ? COLORS.onDark : COLORS.accent,
                  }}
                >
                  {formatDate(doc.issue_date ?? doc.created_at.slice(0, 10))}
                </button>
              ))}
            </div>
          )}

          <dl
            className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs px-3 py-2"
            style={{ color: COLORS.muted }}
          >
            <dt>Issued</dt>
            <dd className="text-right" style={{ color: COLORS.text }}>
              {formatDate(selected.issue_date)}
            </dd>
            <dt>Expires</dt>
            <dd className="text-right" style={{ color: COLORS.text }}>
              {formatDate(selected.expiry_date)}
            </dd>
          </dl>

          <div className="px-3 pb-3">
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src ?? ''}
                alt={`${title} for ${horseName}`}
                className="w-full h-auto rounded border"
                style={{ borderColor: COLORS.borderSoft, backgroundColor: '#ffffff' }}
              />
            )}
            {isPdf && (
              <iframe
                src={src ?? ''}
                title={`${title} for ${horseName}`}
                className="w-full rounded border"
                style={{ height: '32rem', borderColor: COLORS.borderSoft, backgroundColor: '#ffffff' }}
              />
            )}
            {!isImage && !isPdf && (
              <p className="text-sm" style={{ color: COLORS.text }}>
                This file ({selected.mime_type}) cannot be shown in the browser.
              </p>
            )}

            <div className="flex gap-3 mt-2">
              <a
                href={src ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:underline"
                style={{ color: COLORS.accent }}
              >
                Open full size ↗
              </a>
              <a
                href={`/api/horses/${horseId}/documents/${selected.id}/download`}
                className="text-xs hover:underline"
                style={{ color: COLORS.muted }}
              >
                Download
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
