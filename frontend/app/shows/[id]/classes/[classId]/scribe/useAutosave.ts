'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Options {
  /** Serialized form state. A change here is what schedules a save. */
  payload: string;
  /**
   * Commits the given snapshot. Must throw on failure.
   *
   * Takes the payload rather than reading current state: the snapshot that was
   * debounced is the one that must be sent. With per-judge cards the two can
   * differ — switch judges within the settle window and a `save()` that read
   * current state would post the new judge's card in place of the edit that
   * scheduled the save.
   */
  save: (payload: string) => Promise<void>;
  /** Quiet period before committing, in ms. */
  delay?: number;
  enabled?: boolean;
  /**
   * Which record `payload` describes — the judge's card, on the scribe screens.
   *
   * Changing it adopts the incoming payload as already-committed rather than
   * saving it, so flipping between judges' cards to read them does not write
   * each one back. Callers must flush before changing it, or the outgoing
   * card's pending edit is dropped.
   */
  baselineKey?: string;
}

/**
 * Debounced autosave for the scribe forms.
 *
 * Two things this handles that a bare `setTimeout` does not:
 *
 * - **Single flight.** The bulk results save deletes every row for the class
 *   and reinserts, so two requests in flight can interleave and lose a score.
 *   A save that arrives while one is running is queued, not raced.
 * - **Nothing on mount.** `payload` is seeded with what came from the server,
 *   so simply opening a class never writes to it.
 *
 * A failed save leaves `status: 'error'` up with the typed values intact — the
 * scribe keeps their work and can retry. It must never fail silently.
 */
export function useAutosave({
  payload,
  save,
  delay = 1500,
  enabled = true,
  baselineKey,
}: Options) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveRef = useRef(save);
  saveRef.current = save;

  /** Payload as of the last successful commit — anything else is unsaved. */
  const committedRef = useRef(payload);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<string | null>(null);

  const run = useCallback(async (target: string) => {
    if (inFlightRef.current) {
      queuedRef.current = target;
      return;
    }
    inFlightRef.current = true;
    setStatus('saving');
    setError(null);
    try {
      await saveRef.current(target);
      committedRef.current = target;
      setLastSavedAt(new Date());
      setStatus('saved');
    } catch (err: any) {
      setError(err?.message ?? 'Save failed');
      setStatus('error');
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null && queued !== committedRef.current) void run(queued);
    }
  }, []);

  // Declared before the scheduling effect on purpose: both fire on the same
  // commit when the card changes, and this one has to move the baseline first
  // or the scheduler below sees a "changed" payload and saves the card that was
  // merely opened.
  const baselineRef = useRef(baselineKey);
  useEffect(() => {
    if (baselineRef.current === baselineKey) return;
    baselineRef.current = baselineKey;
    committedRef.current = payload;
    setStatus('idle');
  }, [baselineKey, payload]);

  useEffect(() => {
    if (!enabled) return;
    if (payload === committedRef.current) return;
    const timer = setTimeout(() => void run(payload), delay);
    return () => clearTimeout(timer);
  }, [payload, delay, enabled, run]);

  /** Commit immediately — used by the manual Save button and by Post Results,
   *  so a click never posts a class that still has an unsaved keystroke. */
  const flush = useCallback(async () => {
    await run(payload);
  }, [payload, run]);

  return {
    status,
    lastSavedAt,
    error,
    flush,
    dirty: payload !== committedRef.current,
  };
}
