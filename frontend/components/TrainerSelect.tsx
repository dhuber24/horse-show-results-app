'use client';

import { useEffect, useMemo, useState } from 'react';

interface Trainer {
  id: string;
  name: string;
}

interface Props {
  trainerId: string | null;
  trainerName: string | null;
  onChange: (trainerId: string | null, trainerName: string | null) => void;
  disabled?: boolean;
  trainers?: Trainer[];
}

const OTHER_VALUE = '__other__';

export default function TrainerSelect({ trainerId, trainerName, onChange, disabled, trainers: initialTrainers }: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers ?? []);
  const [loading, setLoading] = useState(!initialTrainers);
  const [selection, setSelection] = useState('');
  const [manualName, setManualName] = useState(trainerName ?? '');

  useEffect(() => {
    if (initialTrainers) {
      const sorted = [...initialTrainers].sort((a, b) => a.name.localeCompare(b.name));
      setTrainers(sorted);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch('/api/trainers')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Trainer[]) => {
        if (cancelled) return;
        const sorted = [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        setTrainers(sorted);
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

  useEffect(() => {
    if (trainerId) {
      setSelection(trainerId);
      setManualName('');
      return;
    }
    if (trainerName) {
      setSelection(OTHER_VALUE);
      setManualName(trainerName);
      return;
    }
    setSelection('');
    setManualName('');
  }, [trainerId, trainerName]);

  const isOther = useMemo(() => selection === OTHER_VALUE, [selection]);

  const handleSelectChange = (value: string) => {
    setSelection(value);

    if (!value) {
      setManualName('');
      onChange(null, null);
      return;
    }
    if (value === OTHER_VALUE) {
      const nextManual = trainerName ?? manualName;
      setManualName(nextManual);
      onChange(null, nextManual.trim() ? nextManual : null);
      return;
    }

    setManualName('');
    onChange(value, null);
  };

  const handleManualChange = (value: string) => {
    setManualName(value);
    onChange(null, value.trim() ? value : null);
  };

  if (loading) {
    return (
      <select
        disabled
        value=""
        className="w-full border rounded px-3 py-2 text-sm"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <option value="">Loading trainers...</option>
      </select>
    );
  }

  return (
    <div>
      <select
        value={selection}
        onChange={(e) => handleSelectChange(e.target.value)}
        disabled={disabled}
        className="w-full border rounded px-3 py-2 text-sm"
        style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
      >
        <option value="">- No trainer -</option>
        {trainers.map((trainer) => (
          <option key={trainer.id} value={trainer.id}>
            {trainer.name}
          </option>
        ))}
        <option value={OTHER_VALUE}>Other - enter name</option>
      </select>

      {isOther && (
        <input
          type="text"
          value={manualName}
          onChange={(e) => handleManualChange(e.target.value)}
          placeholder="Trainer name"
          disabled={disabled}
          className="w-full border rounded px-3 py-2 text-sm mt-2"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        />
      )}
    </div>
  );
}
