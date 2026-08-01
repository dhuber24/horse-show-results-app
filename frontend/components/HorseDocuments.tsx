'use client';

import { useState, useEffect, useMemo } from 'react';
import ConfirmDialog from './ConfirmDialog';

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

export default function HorseDocuments({ horseId, initialDocuments, types, emptyLabel, uploadLabel }: Props) {
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
  const freshForm = () => ({ ...emptyUpload, document_type: singleType ?? '' });

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

    const res = await fetch(`/api/horses/${horseId}/documents`, { method: 'POST', body: fd });
    setUploading(false);

    if (res.ok) {
      const created = await res.json();
      setDocs((prev) => [...prev, created]);
      setForm(freshForm());
      setFile(null);
      setShowForm(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Upload failed.');
    }
  };

  const maybeAutoUpload = async (nextForm: typeof form, nextFile: File | null) => {
    if (uploading || !nextFile || !canUpload(nextForm, nextFile)) return;
    await handleUpload(nextForm, nextFile);
  };

  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    const res = await fetch(`/api/horses/${horseId}/documents/${docId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  if (loading) return <p className="text-sm" style={{ color: '#8b7355' }}>Loading...</p>;

  const visibleDocs = filterType ? scopedDocs.filter((d) => d.document_type === filterType) : scopedDocs;

  return (
    <div className="space-y-4">
      {allowedTypes.length > 1 && (
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
          style={{ borderColor: '#d4b896', color: '#2c1810' }}
        >
          <option value="">All documents ({scopedDocs.length})</option>
          {allowedTypes.map((t) => {
            const count = scopedDocs.filter((d) => d.document_type === t.value).length;
            return <option key={t.value} value={t.value}>{t.label} ({count})</option>;
          })}
        </select>
      )}

      {visibleDocs.length === 0 ? (
        <p className="text-sm" style={{ color: '#a89070' }}>
          {filterType ? 'No documents of this type on file.' : emptyLabel ?? 'No documents on file.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleDocs.map((doc) => {
            const typeLabel = DOC_TYPES.find((t) => t.value === doc.document_type)?.label;
            return (
              <li key={doc.id} className="flex items-start justify-between rounded p-3 border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!filterType && !singleType && typeLabel && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0e4d0', color: '#5c3d1e' }}>
                        {typeLabel}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate" style={{ color: '#2c1810' }}>
                      {doc.original_filename}
                    </span>
                    <ExpiryBadge expiry={doc.expiry_date} />
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-x-3" style={{ color: '#8b7355' }}>
                    <span>Issued: {formatDate(doc.issue_date)}</span>
                    <span>Expires: {formatDate(doc.expiry_date)}</span>
                    <span>{formatSize(doc.file_size)}</span>
                  </div>
                </div>
                <div className="flex gap-3 ml-3 shrink-0 items-center">
                  <a
                    href={`/api/horses/${horseId}/documents/${doc.id}/download`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Download
                  </a>
                  <button
                    onClick={() => setConfirmDeleteId(doc.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                  {confirmDeleteId === doc.id && (
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
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <p className="text-sm font-semibold" style={{ color: '#2c1810' }}>Upload Document</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!singleType && (
              <div className="sm:col-span-2">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Document Type *</label>
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
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Issue Date *</label>
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
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Expiry Date *</label>
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
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>File * (PDF or image, max 10 MB)</label>
              <label
                className="flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors hover:bg-amber-50/40"
                style={{ borderColor: '#d4b896' }}
              >
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={async (e) => {
                    const nextFile = e.target.files?.[0] ?? null;
                    setFile(nextFile);
                    await maybeAutoUpload(form, nextFile);
                  }}
                  className="sr-only"
                />
                {file ? (
                  <span className="text-sm font-medium text-center" style={{ color: '#2c1810' }}>{file.name}</span>
                ) : (
                  <>
                    <span className="text-sm font-medium" style={{ color: '#8b4513' }}>Click to choose a file</span>
                    <span className="text-xs mt-1" style={{ color: '#a89070' }}>PDF or image - max 10 MB</span>
                  </>
                )}
              </label>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {!error && file && !uploading && !canUpload(form, file) && (
            <p className="text-xs" style={{ color: '#8b7355' }}>
              Complete {singleType ? '' : 'document type, '}issue date, and expiry date to auto-upload.
            </p>
          )}
          {uploading && (
            <p className="text-xs" style={{ color: '#8b7355' }}>Uploading...</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setShowForm(false); setForm(freshForm()); setFile(null); setError(null); }}
              className="px-4 py-2 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowForm(true); setForm(freshForm()); }}
          className="text-sm font-medium hover:underline"
          style={{ color: '#8b4513' }}
        >
          {uploadLabel ?? '+ Upload Document'}
        </button>
      )}
    </div>
  );
}
