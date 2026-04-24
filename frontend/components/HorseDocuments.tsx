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
  created_at: string;
}

interface Props {
  horseId: string;
  initialDocuments?: Document[];
}

const DOC_TYPES = [
  { value: 'COGGINS',            label: 'Coggins Test (EIA)' },
  { value: 'VACCINATION',        label: 'Vaccination Records' },
  { value: 'HEALTH_CERTIFICATE', label: 'Health Certificate (CVI)' },
  { value: 'REGISTRATION',       label: 'Registration & Membership' },
];

function expiryStatus(expiry: string | null): 'expired' | 'soon' | 'valid' | 'none' {
  if (!expiry) return 'none';
  const today = new Date(); today.setHours(0, 0, 0, 0);
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
    soon:    'bg-yellow-100 text-yellow-700',
    valid:   'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    expired: 'Expired',
    soon:    'Expiring soon',
    valid:   'Valid',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const emptyUpload = { document_type: '', issue_date: '', expiry_date: '' };

export default function HorseDocuments({ horseId, initialDocuments }: Props) {
  const [docs, setDocs] = useState<Document[]>(initialDocuments ?? []);
  const [loading, setLoading] = useState(!initialDocuments);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyUpload);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialDocuments) return;
    fetch(`/api/horses/${horseId}/documents`)
      .then((r) => r.json())
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [horseId, initialDocuments]);

  const handleUpload = async () => {
    if (!form.document_type) { setError('Select a document type.'); return; }
    if (!file) { setError('Choose a file to upload.'); return; }
    if (!form.issue_date) { setError('Enter the issue date.'); return; }
    if (!form.expiry_date) { setError('Enter the expiry date.'); return; }

    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', form.document_type);
    fd.append('issue_date', form.issue_date);
    fd.append('expiry_date', form.expiry_date);

    const res = await fetch(`/api/horses/${horseId}/documents`, { method: 'POST', body: fd });
    setUploading(false);

    if (res.ok) {
      const created = await res.json();
      setDocs((prev) => [...prev, created]);
      setForm(emptyUpload);
      setFile(null);
      setShowForm(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Upload failed.');
    }
  };

  const handleDelete = async (docId: string) => {
    setDeletingId(docId);
    const res = await fetch(`/api/horses/${horseId}/documents/${docId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  if (loading) return <p className="text-sm" style={{ color: '#8b7355' }}>Loading…</p>;

  return (
    <div className="space-y-4">
      {/* Document list grouped by type */}
      {DOC_TYPES.map(({ value, label }) => {
        const typeDocs = docs.filter((d) => d.document_type === value);
        return (
          <div key={value}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b4513' }}>
              {label}
            </p>
            {typeDocs.length === 0 ? (
              <p className="text-xs mb-2" style={{ color: '#a89070' }}>No document on file.</p>
            ) : (
              <ul className="space-y-2 mb-2">
                {typeDocs.map((doc) => (
                  <li key={doc.id} className="flex items-start justify-between rounded p-3 border" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
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
                    <div className="flex gap-3 ml-3 shrink-0">
                      <a
                        href={`/api/horses/${horseId}/documents/${doc.id}/download`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: '#8b4513' }}
                      >
                        Download
                      </a>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingId === doc.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Upload form */}
      {showForm ? (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <p className="text-sm font-semibold" style={{ color: '#2c1810' }}>Upload Document</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Document Type *</label>
              <select
                value={form.document_type}
                onChange={(e) => setForm((p) => ({ ...p, document_type: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Issue Date *</label>
              <input
                type="date"
                value={form.issue_date}
                onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Expiry Date *</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm((p) => ({ ...p, expiry_date: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>File * (PDF or image, max 10 MB)</label>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
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
