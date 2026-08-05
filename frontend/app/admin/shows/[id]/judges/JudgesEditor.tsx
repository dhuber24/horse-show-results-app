'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface JudgeAssociation {
  id: string;
  code: string;
  name: string;
}

export interface AssociationOption {
  id: string;
  code: string;
  name: string;
}

/** A judge as the registry holds them — the source of truth for their details. */
export interface RegistryJudge {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  associations: JudgeAssociation[];
}

/** A registry judge assigned to this show. Details are flattened for display. */
export interface ShowJudgeAssignment {
  id: string;
  show_id: string;
  judge_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  associations: JudgeAssociation[];
  sort_order: number | null;
}

interface Props {
  showId: string;
  initialJudges: ShowJudgeAssignment[];
  registryJudges: RegistryJudge[];
  associations: AssociationOption[];
}

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
  link: '#8b4513',
} as const;

function AssociationBadges({ associations }: { associations: JudgeAssociation[] }) {
  if (associations.length === 0) {
    return (
      <span className="text-xs italic" style={{ color: COLORS.muted }}>
        No associations on file
      </span>
    );
  }
  return (
    <>
      {associations.map((a) => (
        <span
          key={a.id}
          title={a.name}
          className="font-mono font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
        >
          {a.code}
        </span>
      ))}
    </>
  );
}

export default function JudgesEditor({
  showId,
  initialJudges,
  registryJudges,
  associations,
}: Props) {
  const router = useRouter();

  const [judges, setJudges] = useState<ShowJudgeAssignment[]>(initialJudges);
  const [registry, setRegistry] = useState<RegistryJudge[]>(registryJudges);
  const [picking, setPicking] = useState(false);
  const [pickedId, setPickedId] = useState('');
  const [showNewJudgeForm, setShowNewJudgeForm] = useState(false);
  const [newJudge, setNewJudge] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    association_ids: new Set<string>(),
  });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedJudgeIds = useMemo(
    () => new Set(judges.map((j) => j.judge_id)),
    [judges],
  );
  const availableJudges = useMemo(
    () => registry.filter((j) => !assignedJudgeIds.has(j.id)),
    [registry, assignedJudgeIds],
  );
  const picked = availableJudges.find((j) => j.id === pickedId) ?? null;

  function closePicker() {
    setPicking(false);
    setPickedId('');
    setShowNewJudgeForm(false);
    setNewJudge({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      association_ids: new Set(),
    });
    setError(null);
  }

  async function assign(judgeId: string) {
    const res = await fetch(`/api/shows/${showId}/judges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judge_id: judgeId, sort_order: judges.length }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ?? 'Failed to add judge to this show');
    setJudges((prev) => [...prev, data as ShowJudgeAssignment]);
  }

  async function handleAddPicked() {
    if (!pickedId) return;
    setError(null);
    setSaving(true);
    try {
      await assign(pickedId);
      closePicker();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add judge');
    } finally {
      setSaving(false);
    }
  }

  /** Adds the judge to the registry first, then to this show. */
  async function handleCreateAndAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/judges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: newJudge.first_name.trim(),
          last_name: newJudge.last_name.trim(),
          email: newJudge.email.trim() || null,
          phone: newJudge.phone.trim() || null,
          association_ids: Array.from(newJudge.association_ids),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? 'Failed to add judge to the registry');
      const created = data as RegistryJudge;
      setRegistry((prev) =>
        [...prev, created].sort(
          (a, b) =>
            a.last_name.localeCompare(b.last_name) ||
            a.first_name.localeCompare(b.first_name),
        ),
      );
      await assign(created.id);
      closePicker();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add judge');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/shows/${showId}/judges/${assignmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? 'Failed to remove judge');
      }
      setJudges((prev) => prev.filter((j) => j.id !== assignmentId));
      setConfirmDeleteId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove judge');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="p-5 rounded-lg border"
      style={{ borderColor: COLORS.border, backgroundColor: '#fff' }}
    >
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {judges.length === 0 && !picking && (
        <p className="text-sm mb-4" style={{ color: COLORS.muted }}>
          No judges added yet.
        </p>
      )}

      {judges.length > 0 && (
        <ul className="space-y-1 mb-4">
          {judges.map((judge) => (
            <li key={judge.id} className="border-b py-2" style={{ borderColor: COLORS.borderSoft }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: COLORS.text }}>
                    {judge.first_name} {judge.last_name}
                  </p>
                  <div
                    className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
                    style={{ color: COLORS.muted }}
                  >
                    <AssociationBadges associations={judge.associations} />
                    {judge.email && <span>{judge.email}</span>}
                    {judge.phone && <span>{judge.phone}</span>}
                  </div>
                </div>
                <span className="flex items-center gap-3 shrink-0">
                  {confirmDeleteId === judge.id ? (
                    <>
                      <span className="text-xs" style={{ color: COLORS.warn }}>
                        Remove from show?
                      </span>
                      <button
                        onClick={() => handleRemove(judge.id)}
                        disabled={saving}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {saving ? '…' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs hover:underline"
                        style={{ color: COLORS.muted }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(judge.id)}
                      disabled={saving}
                      className="text-xs text-red-600 hover:underline disabled:opacity-30"
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs mb-3" style={{ color: COLORS.muted }}>
        Judge details and association cards come from the judge registry, so the
        same judge reads the same way at every show. Corrections are made in the
        registry, not here.
      </p>

      {!picking && (
        <button
          onClick={() => setPicking(true)}
          className="text-sm hover:underline"
          style={{ color: COLORS.link }}
        >
          + Add judge
        </button>
      )}

      {picking && !showNewJudgeForm && (
        <div className="mt-3 space-y-3">
          <div>
            <label
              className="block text-xs font-medium mb-1"
              htmlFor="judge-picker"
              style={{ color: COLORS.warn }}
            >
              Pick a judge
            </label>
            <select
              id="judge-picker"
              autoFocus
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm"
              style={{ borderColor: COLORS.border }}
            >
              <option value="">— Select a judge —</option>
              {availableJudges.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.last_name}, {j.first_name}
                  {j.associations.length > 0
                    ? ` — ${j.associations.map((a) => a.code).join(', ')}`
                    : ''}
                </option>
              ))}
            </select>
            {availableJudges.length === 0 && (
              <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
                {registry.length === 0
                  ? 'No judges in the registry yet.'
                  : 'Every judge in the registry is already on this show.'}
              </p>
            )}
          </div>

          {picked && (
            <div
              className="rounded border p-3 text-sm space-y-1"
              style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
            >
              <p className="font-medium" style={{ color: COLORS.text }}>
                {picked.first_name} {picked.last_name}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: COLORS.muted }}>
                <AssociationBadges associations={picked.associations} />
                <span>{picked.email || 'No email on file'}</span>
                <span>{picked.phone || 'No phone on file'}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAddPicked}
              disabled={saving || !pickedId}
              title={pickedId ? undefined : 'Pick a judge first'}
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: COLORS.link }}
            >
              {saving ? 'Adding…' : 'Add to show'}
            </button>
            <button
              type="button"
              onClick={closePicker}
              className="px-3 py-1 rounded text-sm border"
              style={{ borderColor: COLORS.border, color: '#5a3e2b' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewJudgeForm(true);
                setError(null);
              }}
              className="text-sm hover:underline"
              style={{ color: COLORS.link }}
            >
              + New judge
            </button>
          </div>
        </div>
      )}

      {picking && showNewJudgeForm && (
        <form onSubmit={handleCreateAndAdd} className="mt-3 space-y-3">
          <p className="text-xs" style={{ color: COLORS.muted }}>
            This adds the judge to the registry and to this show. They will be
            available to pick at every future show.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: COLORS.warn }}>
                First Name *
              </label>
              <input
                autoFocus
                name="first_name"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
                value={newJudge.first_name}
                onChange={(e) => setNewJudge((f) => ({ ...f, first_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: COLORS.warn }}>
                Last Name *
              </label>
              <input
                name="last_name"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
                value={newJudge.last_name}
                onChange={(e) => setNewJudge((f) => ({ ...f, last_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: COLORS.warn }}>
                Email
              </label>
              <input
                type="email"
                name="email"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
                value={newJudge.email}
                onChange={(e) => setNewJudge((f) => ({ ...f, email: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: COLORS.warn }}>
                Phone
              </label>
              <input
                type="tel"
                name="phone"
                className="w-full border rounded px-3 py-1.5 text-sm"
                style={{ borderColor: COLORS.border }}
                value={newJudge.phone}
                onChange={(e) => setNewJudge((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          {associations.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: COLORS.warn }}>
                Carded with
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {associations.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                    style={{ color: COLORS.text }}
                  >
                    <input
                      type="checkbox"
                      checked={newJudge.association_ids.has(a.id)}
                      onChange={(e) => {
                        setNewJudge((f) => {
                          const next = new Set(f.association_ids);
                          if (e.target.checked) next.add(a.id);
                          else next.delete(a.id);
                          return { ...f, association_ids: next };
                        });
                      }}
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !newJudge.first_name.trim() || !newJudge.last_name.trim()}
              title={
                newJudge.first_name.trim() && newJudge.last_name.trim()
                  ? undefined
                  : 'First and last name are required'
              }
              className="px-3 py-1 rounded text-sm text-white disabled:opacity-50"
              style={{ backgroundColor: COLORS.link }}
            >
              {saving ? 'Saving…' : 'Save judge & add to show'}
            </button>
            <button
              type="button"
              onClick={() => setShowNewJudgeForm(false)}
              className="px-3 py-1 rounded text-sm border"
              style={{ borderColor: COLORS.border, color: '#5a3e2b' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
