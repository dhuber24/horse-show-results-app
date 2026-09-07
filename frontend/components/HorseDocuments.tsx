'use client';

import { useState, useEffect, useMemo } from 'react';
import ConfirmDialog from './ConfirmDialog';
import {
  DETAIL_FIELDS,
  ExtractionResponse,
  FIELD_LABELS,
  WIDE_DETAIL_FIELDS,
  analyzeDocument,
  asText,
  reviewWarnings,
  twelveMonthsAfter,
} from '@/lib/document-extraction';

export interface HorseDocument {
  id: string;
  document_type: string;
  document_type_label: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  issue_date: string | null;
  expiry_date: string | null;
  created_at: string;
}

interface Props {
  horseId: string;
  initialDocuments?: HorseDocument[];
  /** Restrict this instance to a subset of DOC_TYPES. Defaults to every type. */
  types?: string[];
  /** Copy shown when this instance has nothing on file. */
  emptyLabel?: string;
  /** Label on the button that opens the upload form. */
  uploadLabel?: string;
  /**
   * Drop the upload and remove controls, leaving list + download. Used for show
   * staff, who may read any horse's paperwork to verify it but do not maintain
   * the record — `_assert_can_manage` in `backend/routers/horse_documents.py`
   * rejects their writes regardless, so offering the controls would only
   * produce a 403.
   */
  readOnly?: boolean;
}

export const DOC_TYPES = [
  { value: 'COGGINS', label: 'Coggins Test (EIA)' },
  { value: 'VACCINATION', label: 'Vaccination Records' },
  { value: 'HEALTH_CERTIFICATE', label: 'Health Certificate (CVI)' },
  { value: 'REGISTRATION', label: 'Registration & Membership' },
];

/** Mirrors MAX_FILE_SIZE in backend/routers/horse_documents.py. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** Paperwork proving the horse is fit to travel and compete. */
export const HEALTH_DOC_TYPES = ['COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE'];
/** Papers backing the association numbers carried by the horse. */
export const REGISTRATION_DOC_TYPES = ['REGISTRATION'];

function expiryStatus(expiry: string | null): 'expired' | 'soon' | 'valid' | 'none' {
  if (!expiry) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'valid';
}

function ExpiryBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return null;
  const status = expiryStatus(expiry);
  const colors: Record<string, string> = {
    expired: 'bg-red-100 text-red-700',
    soon: 'bg-yellow-100 text-yellow-700',
    valid: 'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    expired: 'Expired',
    soon: 'Expiring soon',
    valid: 'Valid',
  };
  return (
    <span suppressHydrationWarning className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const emptyUpload = { document_type: '', issue_date: '', expiry_date: '' };

export default function HorseDocuments({ horseId, initialDocuments, types, emptyLabel, uploadLabel, readOnly }: Props) {
  const [docs, setDocs] = useState<HorseDocument[]>(initialDocuments ?? []);
  const [loading, setLoading] = useState(!initialDocuments);
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyUpload);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResponse | null>(null);

  useEffect(() => {
    if (initialDocuments) return;
    fetch(`/api/horses/${horseId}/documents`)
      .then((r) => r.json())
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [horseId, initialDocuments]);

  // A scoped instance only lists, filters, and uploads its own document types, so
  // Health and Associations can each own the paperwork that belongs under them.
  const allowedTypes = useMemo(
    () => (types ? DOC_TYPES.filter((t) => types.includes(t.value)) : DOC_TYPES),
    [types]
  );
  const scopedDocs = useMemo(
    () => (types ? docs.filter((d) => types.includes(d.document_type)) : docs),
    [docs, types]
  );
  // With a single allowed type there is nothing to pick or filter by — preselect it
  // and drop both controls rather than making the user restate the obvious.
  const singleType = allowedTypes.length === 1 ? allowedTypes[0].value : null;

  // The upload form starts on whatever the list is filtered to. The list filter
  // and the upload type used to be two identical-looking dropdowns stacked in
  // the Health section, so picking "Coggins" to narrow the list and then picking
  // "Coggins" again to upload one read as the app asking the same question
  // twice. The filter is now a row of chips (visibly a filter, not a form
  // field) and it seeds this, so the answer is only ever given once.
  const freshForm = () => ({ ...emptyUpload, document_type: singleType ?? filterType });

  const canUpload = (uploadForm: typeof form, uploadFile: File | null) =>
    !!uploadFile && !!uploadForm.document_type && !!uploadForm.issue_date && !!uploadForm.expiry_date;

  const handleUpload = async (uploadForm: typeof form, uploadFile: File) => {
    if (!canUpload(uploadForm, uploadFile)) return;

    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('document_type', uploadForm.document_type);
    fd.append('issue_date', uploadForm.issue_date);
    fd.append('expiry_date', uploadForm.expiry_date);
    // Records whether these dates were typed, accepted, or corrected.
    if (extraction) fd.append('extraction_id', extraction.extraction_id);

    const res = await fetch(`/api/horses/${horseId}/documents`, { method: 'POST', body: fd });
    setUploading(false);

    if (res.ok) {
      const created = await res.json();
      setDocs((prev) => [...prev, created]);
      // Uploading a type the list is filtered away from would otherwise save the
      // document into a view that hides it, which reads as the upload failing.
      const nextFilter = filterType && filterType !== created.document_type ? '' : filterType;
      setFilterType(nextFilter);
      setForm({ ...emptyUpload, document_type: singleType ?? nextFilter });
      setFile(null);
      setExtraction(null);
      setShowForm(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Upload failed.');
    }
  };

  // Once a document has been read, the uploader must press Save. Auto-upload is
  // for values they typed themselves; letting it fire on extracted values would
  // commit a machine's reading of an expiry date — the field the Coggins entry
  // gate gets checked against — without anyone having looked at it.
  const maybeAutoUpload = async (nextForm: typeof form, nextFile: File | null) => {
    if (extraction || uploading || !nextFile || !canUpload(nextForm, nextFile)) return;
    await handleUpload(nextForm, nextFile);
  };

  const handleFileChosen = async (nextFile: File | null) => {
    setFile(nextFile);
    setExtraction(null);
    setError(null);
    if (!nextFile) return;

    if (nextFile.size > MAX_DOC_BYTES) {
      setError('File is larger than 10 MB.');
      return;
    }

    setReading(true);
    const read = await analyzeDocument(nextFile, horseId);
    setReading(false);

    if (!read) {
      await maybeAutoUpload(form, nextFile);
      return;
    }

    setExtraction(read);
    const f = read.fields;
    setForm((prev) => ({
      document_type: singleType ?? (asText(f.document_type) ?? prev.document_type),
      issue_date: asText(f.issue_date) ?? prev.issue_date,
      expiry_date: asText(f.expiry_date) ?? prev.expiry_date,
    }));
  };

  const extractedFields = extraction?.fields ?? {};
  const lowConfidence = new Set(extraction?.low_confidence_fields ?? []);
  const details = DETAIL_FIELDS
    .map((key) => [key, asText(extractedFields[key])] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null);

  const testDate = asText(extractedFields.test_date);
  const derivedExpiry =
    extraction && form.document_type === 'COGGINS' && !form.expiry_date && testDate
      ? twelveMonthsAfter(testDate)
      : null;

  const fieldHint = (key: string) => {
    if (!extraction) return null;
    if (lowConfidence.has(key)) {
      return <span className="text-xs ml-1" style={{ color: 'var(--warning)' }}>· check this</span>;
    }
    if (asText(extractedFields[key])) {
      return <span className="text-xs ml-1" style={{ color: 'var(--success)' }}>· read from document</span>;
    }
    return <span className="text-xs ml-1" style={{ color: 'var(--text-dimmed)' }}>· not on the document</span>;
  };

  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    const res = await fetch(`/api/horses/${horseId}/documents/${docId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  if (loading) return <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading...</p>;

  const visibleDocs = filterType ? scopedDocs.filter((d) => d.document_type === filterType) : scopedDocs;

  const missingFields = [
    !form.document_type && 'document type',
    !form.issue_date && 'issue date',
    !form.expiry_date && 'expiry date',
  ].filter((label): label is string => Boolean(label));

  return (
    <div className="space-y-4">
      {/* Only worth showing once there is a list to narrow. Chips rather than a
          select: this filters what is displayed, and a second dropdown sitting
          above the upload form's type dropdown read as a second question. */}
      {allowedTypes.length > 1 && scopedDocs.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter documents by type">
          {[{ value: '', label: 'All' }, ...allowedTypes].map((t) => {
            const count = t.value
              ? scopedDocs.filter((d) => d.document_type === t.value).length
              : scopedDocs.length;
            const active = filterType === t.value;
            return (
              <button
                key={t.value || 'all'}
                type="button"
                onClick={() => setFilterType(t.value)}
                aria-pressed={active}
                className="text-xs px-2 py-1 rounded-full border transition-colors"
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                  backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? 'var(--surface)' : 'var(--muted)',
                }}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {visibleDocs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-dimmed)' }}>
          {filterType ? 'No documents of this type on file.' : emptyLabel ?? 'No documents on file.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleDocs.map((doc) => {
            const typeLabel = DOC_TYPES.find((t) => t.value === doc.document_type)?.label;
            return (
              <li key={doc.id} className="flex items-start justify-between rounded p-3 border" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--background)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!filterType && !singleType && typeLabel && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}>
                        {typeLabel}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                      {doc.original_filename}
                    </span>
                    <ExpiryBadge expiry={doc.expiry_date} />
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-x-3" style={{ color: 'var(--muted)' }}>
                    <span>Issued: {formatDate(doc.issue_date)}</span>
                    <span>Expires: {formatDate(doc.expiry_date)}</span>
                    <span>{formatSize(doc.file_size)}</span>
                  </div>
                </div>
                <div className="flex gap-3 ml-3 shrink-0 items-center">
                  <a
                    href={`/api/horses/${horseId}/documents/${doc.id}/download`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Download
                  </a>
                  {!readOnly && (
                    <button
                      onClick={() => setConfirmDeleteId(doc.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  )}
                  {!readOnly && confirmDeleteId === doc.id && (
                    <ConfirmDialog
                      title="Remove Document"
                      message={`Remove ${doc.original_filename}? This cannot be undone.`}
                      confirmLabel="Yes, remove"
                      destructive
                      confirming={deletingId === doc.id}
                      onConfirm={() => { handleDelete(doc.id); setConfirmDeleteId(null); }}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showForm ? (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Upload Document</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!singleType && (
              <div className="sm:col-span-2">
                <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
                  Document Type *{fieldHint('document_type')}
                </label>
                <select
                  value={form.document_type}
                  onChange={async (e) => {
                    const nextForm = { ...form, document_type: e.target.value };
                    setForm(nextForm);
                    await maybeAutoUpload(nextForm, file);
                  }}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  {allowedTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
                Issue Date *{fieldHint('issue_date')}
              </label>
              <input
                type="date"
                value={form.issue_date}
                onChange={async (e) => {
                  const nextForm = { ...form, issue_date: e.target.value };
                  setForm(nextForm);
                  await maybeAutoUpload(nextForm, file);
                }}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>
                Expiry Date *{fieldHint('expiry_date')}
              </label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={async (e) => {
                  const nextForm = { ...form, expiry_date: e.target.value };
                  setForm(nextForm);
                  await maybeAutoUpload(nextForm, file);
                }}
                className="w-full border rounded px-3 py-2 text-sm"
              />
              {derivedExpiry && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, expiry_date: derivedExpiry }))}
                  className="text-xs mt-1 hover:underline text-left"
                  style={{ color: 'var(--accent)' }}
                >
                  No expiry printed. Use {formatDate(derivedExpiry)} — 12 months from the{' '}
                  {formatDate(testDate)} blood draw?
                </button>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>File * (PDF or image, max 10 MB)</label>
              <label
                className="flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors hover:bg-amber-50/40"
                style={{ borderColor: 'var(--border)' }}
              >
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={async (e) => {
                    await handleFileChosen(e.target.files?.[0] ?? null);
                  }}
                  className="sr-only"
                />
                {file ? (
                  <span className="text-sm font-medium text-center" style={{ color: 'var(--foreground)' }}>{file.name}</span>
                ) : (
                  <>
                    <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>Click to choose a file</span>
                    <span className="text-xs mt-1" style={{ color: 'var(--text-dimmed)' }}>PDF or image - max 10 MB</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {reading && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Reading the document to fill in the dates...
            </p>
          )}

          {extraction && (
            <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-deep)' }}>
                Read from the document — check it before saving
              </p>
              {reviewWarnings(extractedFields).map((warning) => (
                <p
                  key={warning}
                  className="text-xs font-medium rounded px-2 py-1.5"
                  style={{ color: 'var(--error-strong)', backgroundColor: 'var(--error-bg)' }}
                >
                  {warning}
                </p>
              ))}
              {extraction.notes && (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>{extraction.notes}</p>
              )}
              {lowConfidence.size > 0 && (
                <p className="text-xs" style={{ color: 'var(--warning)' }}>
                  Hard to read:{' '}
                  {[...lowConfidence].map((k) => FIELD_LABELS[k] ?? k).join(', ')}.
                </p>
              )}
              {details.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {details.map(([key, value]) => (
                    <div key={key} className={`flex gap-2${WIDE_DETAIL_FIELDS.has(key) ? ' sm:col-span-2' : ''}`}>
                      <dt className="shrink-0" style={{ color: 'var(--muted)' }}>
                        {FIELD_LABELS[key] ?? key}:
                      </dt>
                      <dd className={WIDE_DETAIL_FIELDS.has(key) ? 'break-words' : 'truncate'} style={{ color: 'var(--foreground)' }}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-xs" style={{ color: 'var(--text-dimmed)' }}>
                These details are shown so you can verify the document is the right one. Only the
                type and dates above are saved.
              </p>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {!error && !reading && file && !uploading && !canUpload(form, file) && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {/* Names only what is actually missing. Listing "document type"
                  when the filter already supplied it sends people looking for a
                  field that is filled in. */}
              {extraction
                ? `Fill in ${missingFields.join(', ')}, then save.`
                : `Complete ${missingFields.join(', ')} to auto-upload.`}
            </p>
          )}
          {uploading && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Uploading...</p>
          )}

          <div className="flex gap-2">
            {extraction && (
              <button
                onClick={() => file && handleUpload(form, file)}
                disabled={!canUpload(form, file) || uploading}
                title={canUpload(form, file) ? undefined : 'Fill in the type and both dates first.'}
                className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {uploading ? 'Saving...' : 'Looks right — save'}
              </button>
            )}
            <button
              onClick={() => {
                setShowForm(false);
                setForm(freshForm());
                setFile(null);
                setExtraction(null);
                setError(null);
              }}
              className="px-4 py-2 rounded text-sm border"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !readOnly ? (
        <button
          onClick={() => { setShowForm(true); setForm(freshForm()); }}
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {uploadLabel ?? '+ Upload Document'}
        </button>
      ) : null}
    </div>
  );
}
