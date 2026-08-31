'use client';

import { useState, useEffect } from 'react';

interface Association { id: string; code: string; name: string; }
interface Registration {
  id: string;
  association_id: string;
  association_code: string;
  association_name: string;
  member_number: string;
  /** When it lapses. null means unknown, not current (migration 117). */
  expires_at: string | null;
}
interface Certificate {
  id: string;
  document_type: string;
  original_filename: string;
  issue_date: string | null;
  expiry_date: string | null;
  association_id: string | null;
}

interface Props {
  exhibitorId: string;
  initialRegistrations?: Registration[];
  certificates?: Certificate[];
  onCertificateUploaded?: (cert: Certificate) => void;
  onCertificateDeleted?: (certId: string) => void;
}

const UNCERTIFIED_CODES = ['OPEN'];

type CertStatus = 'expired' | 'soon' | 'valid' | 'undated';

function certStatus(expiry: string | null): CertStatus {
  if (!expiry) return 'undated';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'valid';
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_STYLE: Record<CertStatus, { color: string; label: string }> = {
  expired:  { color: '#b91c1c', label: 'Expired' },
  soon:     { color: '#a16207', label: 'Expiring soon' },
  valid:    { color: '#166534', label: 'On file' },
  undated:  { color: '#8b7355', label: 'On file' },
};

export default function ExhibitorRegistrations({
  exhibitorId,
  initialRegistrations,
  certificates = [],
  onCertificateUploaded,
  onCertificateDeleted,
}: Props) {
  const [regs, setRegs] = useState<Registration[]>(initialRegistrations ?? []);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [newReg, setNewReg] = useState({ association_id: '', member_number: '', expires_at: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState<string | null>(null);
  const [deletingRegId, setDeletingRegId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-registration certificate upload state
  const [uploadOpenFor, setUploadOpenFor] = useState<string | null>(null); // association_id
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDates, setUploadDates] = useState({ issue_date: '', expiry_date: '' });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDeleteCertId, setConfirmDeleteCertId] = useState<string | null>(null);
  const [deletingCertId, setDeletingCertId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/associations').then((r) => r.json()).then(setAssociations).catch(() => {});
  }, []);

  const usedAssociationIds = new Set(regs.map((r) => r.association_id));
  const availableAssociations = associations.filter(
    (st) => !UNCERTIFIED_CODES.includes(st.code) && !usedAssociationIds.has(st.id)
  );

  const handleAddReg = async () => {
    if (!newReg.association_id || !newReg.member_number.trim()) {
      setError('Select an association and enter a membership ID.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        association_id: newReg.association_id,
        member_number: newReg.member_number.trim(),
        expires_at: newReg.expires_at || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const created = await res.json();
      setRegs((prev) => [...prev, created]);
      setNewReg({ association_id: '', member_number: '', expires_at: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save membership ID.');
    }
  };

  const handleDeleteReg = async (regId: string) => {
    setDeletingRegId(regId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/registrations/${regId}`, { method: 'DELETE' });
    setDeletingRegId(null);
    if (res.ok || res.status === 204) {
      setRegs((prev) => prev.filter((r) => r.id !== regId));
    }
    setConfirmDeleteRegId(null);
  };

  const openUpload = (associationId: string) => {
    setUploadOpenFor(associationId);
    setUploadFile(null);
    setUploadDates({ issue_date: '', expiry_date: '' });
    setUploadError(null);
  };

  const handleUploadCert = async (reg: Registration) => {
    if (!uploadFile) { setUploadError('Choose a file to upload.'); return; }
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('document_type', 'MEMBERSHIP_CARD');
    fd.append('association_id', reg.association_id);
    if (uploadDates.issue_date) fd.append('issue_date', uploadDates.issue_date);
    if (uploadDates.expiry_date) fd.append('expiry_date', uploadDates.expiry_date);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/documents`, { method: 'POST', body: fd });
    setUploading(false);
    if (res.ok) {
      const created: Certificate = await res.json();
      onCertificateUploaded?.(created);
      setUploadOpenFor(null);
    } else {
      const err = await res.json().catch(() => ({}));
      setUploadError(err.detail ?? 'Upload failed.');
    }
  };

  const handleDeleteCert = async (certId: string) => {
    setDeletingCertId(certId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/documents/${certId}`, { method: 'DELETE' });
    setDeletingCertId(null);
    if (res.ok || res.status === 204) {
      onCertificateDeleted?.(certId);
    }
    setConfirmDeleteCertId(null);
  };

  return (
    <div className="space-y-3">
      {regs.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>No membership IDs on file.</p>
      ) : (
        <ul className="space-y-3">
          {regs.map((reg) => {
            const cert = certificates.find(
              (d) => d.association_id === reg.association_id && d.document_type === 'MEMBERSHIP_CARD'
            ) ?? null;
            const status = cert ? certStatus(cert.expiry_date) : null;
            const isUploadOpen = uploadOpenFor === reg.association_id;

            return (
              <li key={reg.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf6f0' }}>
                {/* Registration row */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-sm font-semibold mr-2" style={{ color: '#8b4513' }}>
                      {reg.association_code}
                    </span>
                    <span className="text-sm" style={{ color: '#2c1810' }}>{reg.member_number}</span>
                    <span className="text-xs ml-2" style={{ color: '#8b7355' }}>({reg.association_name})</span>
                  </div>
                  {confirmDeleteRegId === reg.id ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove?</span>
                      <button onClick={() => handleDeleteReg(reg.id)} disabled={deletingRegId === reg.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">
                        {deletingRegId === reg.id ? 'Removing…' : 'Yes'}
                      </button>
                      <button onClick={() => setConfirmDeleteRegId(null)}
                        className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDeleteRegId(reg.id)}
                      className="text-xs text-red-600 hover:text-red-800 shrink-0">Remove</button>
                  )}
                </div>

                {/* Certificate status */}
                <div className="border-t pt-2" style={{ borderColor: '#f0e4d0' }}>
                  {cert && status ? (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-xs space-y-0.5">
                        <span style={{ color: STATUS_STYLE[status].color }}>
                          {STATUS_STYLE[status].label}
                          {cert.expiry_date ? ` — expires ${formatDate(cert.expiry_date)}` : ''}
                        </span>
                        <div style={{ color: '#8b7355' }}>{cert.original_filename}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <a href={`/api/exhibitors/${exhibitorId}/documents/${cert.id}/download`}
                          className="text-xs font-medium hover:underline" style={{ color: '#8b4513' }}>
                          Download
                        </a>
                        {confirmDeleteCertId === cert.id ? (
                          <span className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: '#5c3d1e' }}>Remove?</span>
                            <button onClick={() => handleDeleteCert(cert.id)} disabled={deletingCertId === cert.id}
                              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">
                              {deletingCertId === cert.id ? 'Removing…' : 'Yes'}
                            </button>
                            <button onClick={() => setConfirmDeleteCertId(null)}
                              className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmDeleteCertId(cert.id)}
                            className="text-xs text-red-600 hover:text-red-800">Remove</button>
                        )}
                      </div>
                    </div>
                  ) : isUploadOpen ? null : (
                    <button onClick={() => openUpload(reg.association_id)}
                      className="text-xs font-medium hover:underline" style={{ color: '#8b4513' }}>
                      + Attach certificate
                    </button>
                  )}

                  {/* Inline upload form */}
                  {isUploadOpen && (
                    <div className="space-y-2 mt-1">
                      <label className="flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed px-4 py-4 cursor-pointer transition-colors hover:bg-amber-50/40"
                        style={{ borderColor: '#d4b896' }}>
                        <input type="file" accept=".pdf,image/*"
                          onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                          className="sr-only" />
                        {uploadFile ? (
                          <span className="text-sm font-medium" style={{ color: '#2c1810' }}>{uploadFile.name}</span>
                        ) : (
                          <>
                            <span className="text-xl mb-1">📎</span>
                            <span className="text-sm font-medium" style={{ color: '#8b4513' }}>Click to choose a file</span>
                            <span className="text-xs mt-0.5" style={{ color: '#a89070' }}>PDF or image — max 10 MB</span>
                          </>
                        )}
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Issue date</label>
                          <input type="date" value={uploadDates.issue_date}
                            onChange={(e) => setUploadDates((p) => ({ ...p, issue_date: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-xs" style={{ borderColor: '#d4b896' }} />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Expiry date</label>
                          <input type="date" value={uploadDates.expiry_date}
                            onChange={(e) => setUploadDates((p) => ({ ...p, expiry_date: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-xs" style={{ borderColor: '#d4b896' }} />
                        </div>
                      </div>
                      {uploadError && <p className="text-red-600 text-xs">{uploadError}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => handleUploadCert(reg)} disabled={uploading}
                          className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                          style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
                          {uploading ? 'Uploading…' : 'Upload'}
                        </button>
                        <button onClick={() => setUploadOpenFor(null)}
                          className="px-3 py-1.5 rounded text-xs border"
                          style={{ borderColor: '#d4b896', color: '#8b7355' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {availableAssociations.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end pt-1">
          <div className="flex-1 min-w-[140px]">
            <select value={newReg.association_id}
              onChange={(e) => setNewReg((p) => ({ ...p, association_id: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm">
              <option value="">Association…</option>
              {availableAssociations.map((st) => (
                <option key={st.id} value={st.id}>{st.code} — {st.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <input value={newReg.member_number}
              onChange={(e) => setNewReg((p) => ({ ...p, member_number: e.target.value }))}
              placeholder="Membership ID"
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          {/* Optional, and worth asking for: the show office checks membership
              standing at the desk, and a number with no expiry beside it can
              only be reported as unknown. */}
          <div className="min-w-[140px]">
            <label className="text-xs block mb-1" style={{ color: '#8b7355' }}>Expires (optional)</label>
            <input type="date" value={newReg.expires_at}
              onChange={(e) => setNewReg((p) => ({ ...p, expires_at: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <button onClick={handleAddReg} disabled={saving}
            className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {availableAssociations.length === 0 && regs.length > 0 && (
        <p className="text-xs" style={{ color: '#8b7355' }}>All associations have a membership ID on file.</p>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
