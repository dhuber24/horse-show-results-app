'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import {
  PATTERN_ACCEPT,
  applyAssignment,
  formatClassDay,
  formatFileSize,
  nameFromFilename,
  patternFileHref,
  wasReplaced,
  type PatternClass,
  type ShowPattern,
} from '@/lib/patterns';

/**
 * The office's pattern library for one show, and the class list that attaches
 * each pattern to the classes that run it.
 *
 * Adding a pattern is what makes it available to exhibitors; attaching it to a
 * class is optional, and only tells them which pattern goes with which class.
 * So the page reads top to bottom in that order: add, what is on file, then the
 * class list — one dropdown per class, grouped by discipline with a "set all"
 * per group, because one showmanship pattern usually runs every showmanship
 * division.
 *
 * When a judge changes a pattern, *Replace file* keeps it attached to its
 * classes and moves its date, which is what tells an exhibitor who read
 * Thursday's copy that it changed. Deleting and re-adding would lose both.
 */

export type PickerClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  discipline_name: string | null;
  score_type: string;
};

const UPLOAD_HINT = 'A PDF, or a JPEG, PNG or WebP image — a photo of a hand-drawn pattern is fine. 10 MB at most.';

/** The "set all" dropdown's value for taking a group's pattern away. */
const NO_PATTERN = '__none__';

const buttonStyle = {
  borderColor: 'var(--border)',
  color: 'var(--foreground)',
  backgroundColor: 'var(--surface)',
} as const;

const fieldStyle = {
  borderColor: 'var(--border)',
  backgroundColor: 'var(--surface)',
  color: 'var(--foreground)',
} as const;

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export default function PatternsClient({
  showId,
  classes,
  initialPatterns,
}: {
  showId: string;
  classes: PickerClass[];
  initialPatterns: ShowPattern[];
}) {
  const [patterns, setPatterns] = useState<ShowPattern[]>(initialPatterns);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  // The class list changes a dropdown the moment it is picked and saves behind
  // it, one request at a time. `confirmed` is the last list the server handed
  // back — what the screen falls back to when a save fails — and only the last
  // answer in a run is drawn, since an earlier one would put back a row the
  // person has already changed again.
  const confirmed = useRef<ShowPattern[]>(initialPatterns);
  const pendingAssignments = useRef(0);
  const assignmentQueue = useRef<Promise<void>>(Promise.resolve());

  const schedule: PatternClass[] = useMemo(
    () =>
      classes.map(({ id, class_number, class_name, class_date }) => ({
        id,
        class_number,
        class_name,
        class_date,
      })),
    [classes],
  );

  const patternOfClass = useMemo(() => {
    const map = new Map<string, ShowPattern>();
    for (const pattern of patterns) for (const cls of pattern.classes) map.set(cls.id, pattern);
    return map;
  }, [patterns]);

  const assigning = savingIds.size > 0;

  // A dropdown shows its new pattern before the save behind it lands, so
  // closing the tab in that second would lose a change the screen already
  // showed as made. The browser's own "leave page?" is the whole guard.
  useEffect(() => {
    if (!assigning) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [assigning]);

  function begin(id: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
  }

  /** A change the server has already made — onto the screen and the fallback. */
  function update(change: (list: ShowPattern[]) => ShowPattern[]) {
    confirmed.current = change(confirmed.current);
    setPatterns(change);
  }

  function replaceOne(updated: ShowPattern) {
    confirmed.current = confirmed.current.map((p) => (p.id === updated.id ? updated : p));
    // The classes shown stay the screen's own: they may carry a class-list
    // change still on its way to the server.
    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? { ...updated, classes: p.classes } : p)));
  }

  async function uploadNew(file: File, name: string, notes: string): Promise<boolean> {
    begin('new');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name);
      if (notes.trim()) form.append('notes', notes);
      const res = await fetch(`/api/shows/${showId}/patterns`, { method: 'POST', body: form });
      const json = await readJson(res);
      if (!res.ok) {
        setError(errorMessage(json, 'Could not add that pattern.'));
        return false;
      }
      const created = json as ShowPattern;
      update((list) => [...list, created]);
      setSuccess(
        classes.length > 0
          ? `“${created.name}” added. Exhibitors can view it now — attach it to its classes below if you like.`
          : `“${created.name}” added. Exhibitors can view it now.`,
      );
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function replaceFile(patternId: string, file: File) {
    begin(patternId);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/shows/${showId}/patterns/${patternId}/file`, {
        method: 'PUT',
        body: form,
      });
      const json = await readJson(res);
      if (!res.ok) {
        setError(errorMessage(json, 'Could not replace that file.'));
        return;
      }
      const updated = json as ShowPattern;
      replaceOne(updated);
      setSuccess(`“${updated.name}” replaced. Exhibitors now see the new file, marked with the time it changed.`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(patternId: string, name: string, notes: string): Promise<boolean> {
    begin(patternId);
    try {
      const res = await fetch(`/api/shows/${showId}/patterns/${patternId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, notes }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setError(errorMessage(json, 'Could not save that pattern.'));
        return false;
      }
      replaceOne(json as ShowPattern);
      setEditingId(null);
      setSuccess('Saved.');
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function remove(patternId: string) {
    begin(patternId);
    try {
      const res = await fetch(`/api/shows/${showId}/patterns/${patternId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(errorMessage(await readJson(res), 'Could not delete that pattern.'));
        return;
      }
      update((list) => list.filter((p) => p.id !== patternId));
      setConfirmDeleteId(null);
      setSuccess('Pattern deleted.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyId(null);
    }
  }

  function assign(classIds: string[], patternId: string | null) {
    setError(null);
    setSuccess(null);
    setPatterns((prev) => applyAssignment(prev, schedule, classIds, patternId));
    setSavingIds((prev) => new Set([...prev, ...classIds]));
    pendingAssignments.current += 1;

    assignmentQueue.current = assignmentQueue.current.then(async () => {
      try {
        const res = await fetch(`/api/shows/${showId}/patterns/assignments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_ids: classIds, pattern_id: patternId }),
        });
        const json = await readJson(res);
        if (res.ok) confirmed.current = json as ShowPattern[];
        else setError(errorMessage(json, 'Could not attach that pattern.'));
      } catch {
        setError('Could not reach the server.');
      } finally {
        pendingAssignments.current -= 1;
        if (pendingAssignments.current === 0) setPatterns(confirmed.current);
        setSavingIds((prev) => {
          const next = new Set(prev);
          for (const id of classIds) next.delete(id);
          return next;
        });
      }
    });
  }

  return (
    <div className="space-y-8">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--success-border)', backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
          role="status"
        >
          {success}
        </div>
      )}

      {/* One hidden input serves every card's Replace button. */}
      <input
        ref={replaceInput}
        type="file"
        accept={PATTERN_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceTarget.current;
          // Cleared so choosing the same file twice still fires.
          e.target.value = '';
          if (file && target) void replaceFile(target, file);
        }}
      />

      <AddPatternForm busy={busyId === 'new'} onUpload={uploadNew} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            On file{patterns.length > 0 ? ` (${patterns.length})` : ''}
          </h2>
          {patterns.length > 0 && (
            <a
              href={`/shows/${showId}/patterns`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              View as exhibitors see it ↗
            </a>
          )}
        </div>
        {patterns.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No patterns yet. Add the first one above.
          </p>
        ) : (
          <ul className="space-y-3">
            {patterns.map((pattern) => (
              <PatternCard
                key={pattern.id}
                showId={showId}
                pattern={pattern}
                busy={busyId === pattern.id}
                anyBusy={busyId !== null || assigning}
                editing={editingId === pattern.id}
                confirmingDelete={confirmDeleteId === pattern.id}
                onReplace={() => {
                  replaceTarget.current = pattern.id;
                  replaceInput.current?.click();
                }}
                onEdit={() => setEditingId(editingId === pattern.id ? null : pattern.id)}
                onSaveEdit={(name, notes) => saveEdit(pattern.id, name, notes)}
                onAskDelete={() => setConfirmDeleteId(pattern.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onDelete={() => remove(pattern.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <ClassList
        classes={classes}
        patterns={patterns}
        patternOfClass={patternOfClass}
        savingIds={savingIds}
        locked={busyId !== null}
        onAssign={assign}
      />
    </div>
  );
}

function AddPatternForm({
  busy,
  onUpload,
}: {
  busy: boolean;
  onUpload: (file: File, name: string, notes: string) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function choose(picked: File | undefined | null) {
    if (!picked) return;
    setFile(picked);
    setName(nameFromFilename(picked.name));
  }

  function reset() {
    setFile(null);
    setName('');
    setNotes('');
  }

  const nameMissing = name.trim() === '';

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>Add a pattern</h2>

      <input
        ref={input}
        type="file"
        accept={PATTERN_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          choose(picked);
        }}
      />

      {!file ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
          title={UPLOAD_HINT}
          className="w-full rounded-lg border-2 border-dashed px-4 py-6 text-sm text-center transition"
          style={{
            borderColor: dragging ? 'var(--accent)' : 'var(--border)',
            backgroundColor: dragging ? 'var(--bg-subtle)' : 'var(--background)',
            color: 'var(--text-deep)',
          }}
        >
          <span className="block font-medium" style={{ color: 'var(--foreground)' }}>
            Choose the pattern file, or drop it here
          </span>
          <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>{UPLOAD_HINT}</span>
        </button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (nameMissing || busy) return;
            if (await onUpload(file, name, notes)) reset();
          }}
        >
          <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
            <span className="font-medium" style={{ color: 'var(--foreground)' }}>{file.name}</span>{' '}
            · {formatFileSize(file.size)} ·{' '}
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="underline disabled:opacity-50"
              style={{ color: 'var(--accent)' }}
            >
              Choose a different file
            </button>
          </p>

          <label className="block">
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              placeholder="Showmanship Pattern 2"
              title="What exhibitors look for on the list."
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              style={fieldStyle}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Notes <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Walk-trot riders trot where the pattern lopes."
              title="Anything the drawing itself does not say."
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              style={fieldStyle}
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || nameMissing}
              title={nameMissing ? 'Give the pattern a name first — it is what exhibitors look for.' : undefined}
              className="text-sm rounded px-4 py-2 font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
            >
              {busy ? 'Uploading…' : 'Add pattern'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="text-sm rounded px-4 py-2 border disabled:opacity-50"
              style={buttonStyle}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PatternCard({
  showId,
  pattern,
  busy,
  anyBusy,
  editing,
  confirmingDelete,
  onReplace,
  onEdit,
  onSaveEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  showId: string;
  pattern: ShowPattern;
  busy: boolean;
  anyBusy: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  onReplace: () => void;
  onEdit: () => void;
  onSaveEdit: (name: string, notes: string) => Promise<boolean>;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const replaced = wasReplaced(pattern);
  const classCount = pattern.classes.length;
  const waitTitle = anyBusy ? 'Wait for the save in progress to finish.' : undefined;

  return (
    <li
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>{pattern.name}</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {pattern.original_filename} · {formatFileSize(pattern.file_size)}
            {pattern.created_at && (
              <>
                {' '}· added <LocalTime iso={pattern.created_at} />
              </>
            )}
            {replaced && (
              <>
                {' '}·{' '}
                <span style={{ color: 'var(--warning)' }}>
                  replaced <LocalTime iso={pattern.file_uploaded_at} />
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={patternFileHref(showId, pattern.id, { version: pattern.file_uploaded_at })}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm rounded px-3 py-1.5 border"
            style={buttonStyle}
          >
            Open
          </a>
          <button
            type="button"
            onClick={onReplace}
            disabled={anyBusy}
            title={waitTitle ?? 'The judge changed it: upload the new file. It stays attached to its classes, and exhibitors see when it changed.'}
            className="text-sm rounded px-3 py-1.5 border disabled:opacity-50"
            style={buttonStyle}
          >
            {busy ? 'Working…' : 'Replace file'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={anyBusy && !editing}
            title={editing ? undefined : waitTitle}
            className="text-sm rounded px-3 py-1.5 border disabled:opacity-50"
            style={buttonStyle}
          >
            {editing ? 'Close' : 'Rename'}
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            disabled={anyBusy}
            title={waitTitle}
            className="text-sm rounded px-3 py-1.5 border disabled:opacity-50"
            style={{ ...buttonStyle, color: 'var(--error-strong)' }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Inline confirmation, not a modal — the repo's delete pattern. */}
      {confirmingDelete && (
        <div
          className="rounded border px-3 py-2 text-sm flex items-center gap-3 flex-wrap"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
        >
          <span>
            Delete &ldquo;{pattern.name}&rdquo;? Exhibitors will no longer see it
            {classCount > 0 &&
              `, and ${classCount} ${classCount === 1 ? 'class' : 'classes'} will have no pattern`}
            .
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="underline font-medium disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete pattern'}
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={busy}
            className="underline disabled:opacity-50"
            style={{ color: 'var(--muted)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {editing ? (
        <EditPatternForm pattern={pattern} busy={busy} onSave={onSaveEdit} />
      ) : (
        pattern.notes && (
          <p className="text-sm whitespace-pre-line" style={{ color: 'var(--text-deep)' }}>
            {pattern.notes}
          </p>
        )
      )}

      {classCount > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {pattern.classes.map((cls) => (
            <li
              key={cls.id}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
              title={formatClassDay(cls.class_date)}
            >
              {cls.class_number} {cls.class_name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Not attached to a class — exhibitors can still view it on the patterns list.
        </p>
      )}
    </li>
  );
}

function EditPatternForm({
  pattern,
  busy,
  onSave,
}: {
  pattern: ShowPattern;
  busy: boolean;
  onSave: (name: string, notes: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(pattern.name);
  const [notes, setNotes] = useState(pattern.notes ?? '');
  const nameMissing = name.trim() === '';

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!nameMissing) void onSave(name, notes);
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        required
        aria-label="Pattern name"
        className="w-full rounded border px-3 py-2 text-sm"
        style={fieldStyle}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={2}
        aria-label="Notes"
        placeholder="Notes (optional)"
        className="w-full rounded border px-3 py-2 text-sm"
        style={fieldStyle}
      />
      <button
        type="submit"
        disabled={busy || nameMissing}
        title={nameMissing ? 'A pattern needs a name.' : undefined}
        className="text-sm rounded px-4 py-2 font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/**
 * Every class, with the pattern it runs.
 *
 * Grouped by discipline rather than in running order, because that is how a
 * pattern is used — one showmanship pattern across every showmanship division
 * — and the group's "Set all" does thirteen rows in one pick. Each row still
 * carries its own number and day. Rail and timed classes are out of the way by
 * default; a show whose score types were never set has no pattern classes at
 * all, and then everything is shown, since an empty list would read as "no
 * classes".
 */
function ClassList({
  classes,
  patterns,
  patternOfClass,
  savingIds,
  locked,
  onAssign,
}: {
  classes: PickerClass[];
  patterns: ShowPattern[];
  patternOfClass: Map<string, ShowPattern>;
  savingIds: Set<string>;
  locked: boolean;
  onAssign: (classIds: string[], patternId: string | null) => void;
}) {
  const hasPatternClasses = classes.some((c) => c.score_type === 'pattern');
  const [showAll, setShowAll] = useState(!hasPatternClasses);

  const judged = classes.filter((c) => c.score_type === 'pattern');
  const judgedWithOne = judged.filter((c) => patternOfClass.has(c.id)).length;
  // A class with a pattern attached never drops out of view, whatever it is
  // judged on — hiding it would hide the one row that explains a chip above.
  const visible = classes.filter(
    (c) => showAll || c.score_type === 'pattern' || patternOfClass.has(c.id),
  );
  const hiddenCount = classes.length - visible.length;

  const groups: { key: string; items: PickerClass[] }[] = [];
  const byKey = new Map<string, PickerClass[]>();
  for (const cls of visible) {
    const key = cls.discipline_name || 'Other classes';
    let items = byKey.get(key);
    if (!items) {
      items = [];
      byKey.set(key, items);
      groups.push({ key, items });
    }
    items.push(cls);
  }

  const noPatterns = patterns.length === 0;
  const disabledTitle = noPatterns
    ? 'Add a pattern above first.'
    : locked
      ? 'Wait for the save in progress to finish.'
      : undefined;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Classes</h2>
        {judged.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {judgedWithOne} of {judged.length} classes judged on a pattern have one attached
          </p>
        )}
      </div>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Optional. Choose the pattern each class runs, and exhibitors see it beside that class.
      </p>

      {classes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          This show has no classes yet. Build the schedule first, then come back to attach patterns.
        </p>
      ) : (
        <>
          {hasPatternClasses && (
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show rail and timed classes too
              {!showAll && hiddenCount > 0 && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>({hiddenCount} hidden)</span>
              )}
            </label>
          )}

          <div
            className="rounded-lg border divide-y"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {groups.map((group) => (
              <div key={group.key} className="p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                    {group.key}{' '}
                    <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
                      {group.items.length} {group.items.length === 1 ? 'class' : 'classes'}
                    </span>
                  </h3>
                  {group.items.length > 1 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        onAssign(
                          group.items.map((c) => c.id),
                          value === NO_PATTERN ? null : value,
                        );
                      }}
                      disabled={noPatterns || locked}
                      title={disabledTitle}
                      aria-label={`Set every ${group.key} class to one pattern`}
                      className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      style={fieldStyle}
                    >
                      <option value="" disabled>
                        Set all {group.items.length} to…
                      </option>
                      {patterns.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                      <option value={NO_PATTERN}>No pattern</option>
                    </select>
                  )}
                </div>
                <ul>
                  {group.items.map((cls) => {
                    const current = patternOfClass.get(cls.id);
                    const saving = savingIds.has(cls.id);
                    return (
                      <li
                        key={cls.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-1.5"
                      >
                        <span className="flex-1 min-w-0 text-sm" style={{ color: 'var(--text-deep)' }}>
                          <span style={{ color: 'var(--foreground)' }}>
                            {cls.class_number} — {cls.class_name}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            {' '}· {formatClassDay(cls.class_date)}
                            {saving && ' · saving…'}
                          </span>
                        </span>
                        <select
                          value={current?.id ?? ''}
                          onChange={(e) => onAssign([cls.id], e.target.value || null)}
                          disabled={noPatterns || locked || saving}
                          title={saving ? 'Saving…' : disabledTitle}
                          aria-label={`Pattern for class ${cls.class_number}`}
                          className="sm:w-64 rounded border px-2 py-1 text-sm disabled:opacity-50"
                          style={{ ...fieldStyle, color: current ? 'var(--foreground)' : 'var(--muted)' }}
                        >
                          <option value="">No pattern</option>
                          {patterns.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
