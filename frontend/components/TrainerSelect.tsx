'use client';

import { useEffect, useState } from 'react';

interface Trainer {
  id: string;
  name: string;
}

interface Props {
  trainerId: string | null;
  /** The horse's trainer as it reads now: a linked trainer's name, or legacy free text. */
  trainerName: string | null;
  onChange: (next: { trainerId: string | null; trainerName: string | null }) => void;
  disabled?: boolean;
  trainers?: Trainer[];
}

/** Keeps the trainer the horse already had when that trainer has no account. */
const CURRENT_VALUE = '__current__';

/**
 * Picks a horse's trainer from the trainers who have their own GaitDesk account
 * (`GET /trainers/names`), and nothing else (2026-11-13). There is no "Other —
 * enter trainer details": that minted a `trainers` row nobody had signed up for,
 * and the backend now refuses it.
 *
 * A horse whose trainer was typed in before that rule keeps them, offered as
 * their own option, until somebody picks another: otherwise saving the horse for
 * any other reason would quietly drop its trainer.
 */
export default function TrainerSelect({ trainerId, trainerName, onChange, disabled, trainers: initialTrainers }: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers ?? []);
  const [loading, setLoading] = useState(!initialTrainers);
  // What the horse had when the form opened, so it can be picked back.
  const [original] = useState(() => ({ id: trainerId, name: trainerName }));

  useEffect(() => {
    if (initialTrainers) {
      setTrainers([...initialTrainers].sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch('/api/trainers')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Trainer[]) => {
        if (cancelled) return;
        setTrainers([...(Array.isArray(data) ? data : [])].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (!cancelled) setTrainers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialTrainers]);

  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

  if (loading) {
    return (
      <select disabled value="" className="w-full border rounded px-3 py-2 text-sm" style={inputStyle}>
        <option value="">Loading trainers...</option>
      </select>
    );
  }

  const listed = (id: string | null) => !!id && trainers.some((t) => t.id === id);
  // The horse's trainer from before, when the list does not offer them.
  const unlisted = (original.id && !listed(original.id)) || (!original.id && original.name)
    ? original
    : null;

  const selection = listed(trainerId)
    ? trainerId!
    : unlisted && trainerId === unlisted.id && (trainerId || trainerName === unlisted.name)
      ? CURRENT_VALUE
      : '';

  const handleSelectChange = (value: string) => {
    if (!value) {
      onChange({ trainerId: null, trainerName: null });
    } else if (value === CURRENT_VALUE && unlisted) {
      onChange({ trainerId: unlisted.id, trainerName: unlisted.name });
    } else {
      onChange({ trainerId: value, trainerName: trainers.find((t) => t.id === value)?.name ?? null });
    }
  };

  return (
    <div>
      <select
        value={selection}
        onChange={(e) => handleSelectChange(e.target.value)}
        disabled={disabled}
        className="w-full border rounded px-3 py-2 text-sm"
        style={inputStyle}
      >
        <option value="">- No trainer -</option>
        {unlisted && (
          <option value={CURRENT_VALUE}>{unlisted.name || 'Current trainer'} (no GaitDesk account)</option>
        )}
        {trainers.map((trainer) => (
          <option key={trainer.id} value={trainer.id}>
            {trainer.name}
          </option>
        ))}
      </select>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {trainers.length === 0
          ? 'No trainers have a GaitDesk account yet. '
          : 'Only trainers with their own GaitDesk account are listed. '}
        Trainer not here? Ask them to sign up as a trainer at{' '}
        <span style={{ color: 'var(--text-deep)' }}>gaitdesk.com/register/trainer</span>, then pick them.
      </p>
    </div>
  );
}
