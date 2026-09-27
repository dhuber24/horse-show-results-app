/**
 * A show's patterns (migration 146) — the types, the file link, and the few
 * rules every screen that prints one has to agree on.
 *
 * Client-safe on purpose: the office's editor and the gate panel are client
 * components, so nothing here may import the session. The server fetcher is
 * `fetchShowPatterns` in `lib/api.ts`.
 */

export type PatternClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
};

export type ShowPattern = {
  id: string;
  show_id: string;
  name: string;
  notes: string | null;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string | null;
  /** When the *current* file went up. Moves when the office replaces it. */
  file_uploaded_at: string;
  /** In schedule order. */
  classes: PatternClass[];
};

/** What the upload takes — the backend reads the real type off the bytes. */
export const PATTERN_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * The pattern's file, through the Next handler (the backend's host is a
 * container name the browser cannot reach).
 *
 * `version` puts the upload time in the URL, so a replaced pattern is a
 * different address from the one somebody opened on Thursday. The server
 * already says `no-cache`; this is for anything between the two that does not
 * listen.
 */
export function patternFileHref(
  showId: string,
  patternId: string,
  opts: { download?: boolean; version?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (opts.download) params.set('download', '1');
  if (opts.version) params.set('v', String(new Date(opts.version).getTime() || opts.version));
  const query = params.toString();
  return `/api/shows/${showId}/patterns/${patternId}/file${query ? `?${query}` : ''}`;
}

/**
 * The name the upload form suggests, from the file somebody picked.
 *
 * 'Showmanship_Pattern-2.pdf' -> 'Showmanship Pattern 2'. The same guess as
 * `name_from_filename` in `routers/show_patterns.py`, which only decides for a
 * caller that sent no name at all.
 */
export function nameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return stem.replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean).join(' ').slice(0, 200);
}

/**
 * Whether the file was replaced after the pattern was first put on file —
 * the judge changed it. A fresh upload writes both timestamps from one
 * statement's `now()`, so they match; the second's grace is only for a
 * reader handed them through something that rounds.
 */
export function wasReplaced(pattern: Pick<ShowPattern, 'created_at' | 'file_uploaded_at'>): boolean {
  if (!pattern.created_at) return false;
  const created = new Date(pattern.created_at).getTime();
  const uploaded = new Date(pattern.file_uploaded_at).getTime();
  if (Number.isNaN(created) || Number.isNaN(uploaded)) return false;
  return uploaded - created > 1_000;
}

/**
 * The patterns that run any of `classIds`, each narrowed to just those
 * classes — "the patterns for my classes", in the order the list gave them.
 */
export function patternsForClasses(
  patterns: ShowPattern[],
  classIds: Iterable<string>,
): ShowPattern[] {
  const wanted = new Set(classIds);
  if (wanted.size === 0) return [];
  return patterns
    .map((pattern) => ({
      ...pattern,
      classes: pattern.classes.filter((cls) => wanted.has(cls.id)),
    }))
    .filter((pattern) => pattern.classes.length > 0);
}

/**
 * `patterns` with `classIds` pointed at `patternId` (null: at no pattern) —
 * what the office's class list shows the moment a dropdown changes, before the
 * server answers. A class runs one pattern, so each one leaves wherever it was.
 * `schedule` is every class in running order, which is the order a pattern's
 * classes are kept in. The server's answer replaces this once it arrives.
 */
export function applyAssignment(
  patterns: ShowPattern[],
  schedule: PatternClass[],
  classIds: string[],
  patternId: string | null,
): ShowPattern[] {
  const moving = new Set(classIds);
  const position = new Map(schedule.map((cls, index) => [cls.id, index]));
  return patterns.map((pattern) => {
    const kept = pattern.classes.filter((cls) => !moving.has(cls.id));
    if (pattern.id !== patternId) {
      return kept.length === pattern.classes.length ? pattern : { ...pattern, classes: kept };
    }
    const added = schedule.filter((cls) => moving.has(cls.id));
    const classes = [...kept, ...added].sort(
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    );
    return { ...pattern, classes };
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Sat, Sep 26" — a class's day, parsed as a calendar date rather than as a
 *  UTC midnight that would print as the day before west of Greenwich. */
export function formatClassDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
