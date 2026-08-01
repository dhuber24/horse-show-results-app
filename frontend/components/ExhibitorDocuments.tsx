'use client';

import { useState, useEffect } from 'react';

interface Document {
  id: string;
  document_type: string;
  document_type_label: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  issue_date: string | null;
  expiry_date: string | null;
  association_id: string | null;
  association_code: string | null;
  association_name: string | null;
  created_at: string;
}

interface Association { id: string; code: string; name: string; }

interface Props {
  exhibitorId: string;
  initialDocuments?: Document[];
  onDocumentsChange?: (docs: Document[]) => void;
}

const DOC_TYPES = [
  { value: 'MEMBERSHIP_CARD', label: 'Membership Card' },
  { value: 'AMATEUR_CARD', label: 'Amateur Card' },
  { value: 'YOUTH_CARD', label: 'Youth Card' },
  { value: 'MEDICAL', label: 'Medical Documentation' },
  { value: 'IDENTIFICATION', label: 'Identification' },
  { value: 'OTHER', label: 'Other' },
];

const ASSOCIATION_LINKED_TYPES = new Set(['MEMBERSHIP_CARD', 'AMATEUR_CARD', 'YOUTH_CARD']);
const UNCERTIFIED_CODES = ['OPEN'];

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

const emptyUpload = { document_type: '', issue_date: '', expiry_date: '', association_id: '' };

export default function ExhibitorDocuments({ exhibitorId, initialDocuments, onDocumentsChange }: Props) {
  const [docs, setDocs] = useState<Document[]>(initialDocuments ?? []);
  const [loading, setLoading] = useState(!initialDocuments);
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyUpload);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [associations, setAssociations] = useState<Association[]>([]);

  const updateDocs = (next: Document[]) => {
    setDocs(next);
    onDocumentsChange?.(next);
  };

  useEffect(() => {
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialDocuments) return;
    fetch(`/api/exhibitors/${exhibitorId}/documents`)
      .then((r) => r.json())
      .then((d: Document[]) => updateDocs(d))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibitorId, initialDocuments]);

  const associationOptions = associations.filter((st) => !UNCERTIFIED_CODES.includes(st.code));
  const showTypeNeeded = ASSOCIATION_LINKED_TYPES.has(form.document_type);

  const canUpload = (uploadForm: typeof form, uploadFile: File | null) => {
    if (!uploadFile || !uploadForm.document_type) return false;
    if (ASSOCIATION_LINKED_TYPES.has(uploadForm.document_type) && !uploadForm.association_id) return false;
    return true;
  };

  const handleUpload = async (uploadForm: typeof form, uploadFile: File) => {
    if (!canUpload(uploadForm, uploadFile)) return;

    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('document_type', uploadForm.document_type);
    if (uploadForm.issue_date) fd.append('issue_date', uploadForm.issue_date);
    if (uploadForm.expiry_date) fd.append('expiry_date', uploadForm.expiry_date);
    if (uploadForm.association_id) fd.append('association_id', uploadForm.association_id);

    const res = await fetch(`/api/exhibitors/${exhibitorId}/documents`, { method: 'POST', body: fd });
    setUploading(false);

    if (res.ok) {
      const created = await res.json();
      updateDocs([...docs, created]);
      setForm(emptyUpload);
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

  const handleTagAssociation = async (docId: string, associationId: string) => {
    setTaggingId(docId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/documents/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: associationId
        ? JSON.stringify({ association_id: associationId })
        : JSON.stringify({ clear_association: true }),
    });
    setTaggingId(null);
    if (res.ok) {
      const updated: Document = await res.json();
      updateDocs(docs.map((d) => (d.id === updated.id ? updated : d)));
    }
  };

  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/documents/${docId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok || res.status === 204) {
      updateDocs(docs.filter((d) => d.id !== docId));
    }
    setConfirmDeleteId(null);
  };

  if (loading) return <p className="text-sm" style={{ color: '#8b7355' }}>Loading...</p>;

  const visibleDocs = filterType ? docs.filter((d) => d.document_type === filterType) : docs;

  return (
    <div className="space-y-4">
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value)}
        className="border rounded px-3 py-2 text-sm"
        style={{ borderColor: '#d4b896', color: '#2c1810' }}
      >
        <option value="">All documents ({docs.length})</option>
        {DOC_TYPES.map((t) => {
          const count = docs.filter((d) => d.document_type === t.value).length;
          return <option key={t.value} value={t.value}>{t.label} ({count})</option>;
        })}
      </select>

      {visibleDocs.length === 0 ? (
        <p className="text-sm" style={{ color: '#a89070' }}>
          {filterType ? 'No documents of this type on file.' : 'No documents on file.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleDocs.map((doc) => {
            const wantsAssociation = ASSOCIATION_LINKED_TYPES.has(doc.document_type);
            const typeLabel = DOC_TYPES.find((t) => t.value === doc.document_type)?.label;
            return (
              <li key={doc.id} className="flex items-start justify-between rounded p-3 border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!filterType && typeLabel && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0e4d0', color: '#5c3d1e' }}>
                        {typeLabel}
                      </span>
                    )}
                    {doc.association_code && (
                      <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0e4d0', color: '#8b4513' }}>
                        {doc.association_code}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate" style={{ color: '#2c1810' }}>
                      {doc.original_filename}
                    </span>
                    <ExpiryBadge expiry={doc.expiry_date} />
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap gap-x-3" style={{ color: '#8b7355' }}>
                    {doc.issue_date && <span>Issued: {formatDate(doc.issue_date)}</span>}
                    {doc.expiry_date && <span>Expires: {formatDate(doc.expiry_date)}</span>}
                    <span>{formatSize(doc.file_size)}</span>
                  </div>
                  {wantsAssociation && !doc.association_id && associationOptions.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs" style={{ color: '#8b4513' }}>Tag association:</label>
                      <select
                        disabled={taggingId === doc.id}
                        defaultValue=""
                        onChange={(e) => e.target.value && handleTagAssociation(doc.id, e.target.value)}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="">Select...</option>
                        {associationOptions.map((st) => (
                          <option key={st.id} value={st.id}>{st.code}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 ml-3 shrink-0 items-center">
                  <a
                    href={`/api/exhibitors/${exhibitorId}/documents/${doc.id}/download`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Download
                  </a>
                  {confirmDeleteId === doc.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove?</span>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingId === doc.id ? 'Removing...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs hover:underline"
                        style={{ color: '#8b7355' }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(doc.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
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
            <div className="sm:col-span-2">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Document Type *</label>
              <select
                value={form.document_type}
                onChange={async (e) => {
                  const nextForm = {
                    ...form,
                    document_type: e.target.value,
                    association_id: ASSOCIATION_LINKED_TYPES.has(e.target.value) ? form.association_id : '',
                  };
                  setForm(nextForm);
                  await maybeAutoUpload(nextForm, file);
                }}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {showTypeNeeded && (
              <div className="sm:col-span-2">
                <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Association *</label>
                <select
                  value={form.association_id}
                  onChange={async (e) => {
                    const nextForm = { ...form, association_id: e.target.value };
                    setForm(nextForm);
                    await maybeAutoUpload(nextForm, file);
                  }}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  {associationOptions.map((st) => (
                    <option key={st.id} value={st.id}>{st.code} - {st.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Issue Date</label>
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
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Expiry Date</label>
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
              Complete required dropdowns to auto-upload this file.
            </p>
          )}
          {uploading && (
            <p className="text-xs" style={{ color: '#8b7355' }}>Uploading...</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setShowForm(false); setForm(emptyUpload); setFile(null); setError(null); }}
              className="px-4 py-2 rounded text-sm border"
              style={{ borderColor: '#d4b896', color: '#8b7355' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm font-medium hover:underline"
          style={{ color: '#8b4513' }}
        >
          + Upload Document
        </button>
      )}
    </div>
  );
}
