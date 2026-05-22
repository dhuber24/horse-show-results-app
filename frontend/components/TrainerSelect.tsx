'use client';

import { useEffect, useMemo, useState } from 'react';

interface Trainer {
  id: string;
  name: string;
}

interface Props {
  trainerId: string | null;
  trainerName: string | null;
  trainerFirstName?: string | null;
  trainerLastName?: string | null;
  trainerEmail?: string | null;
  onChange: (next: {
    trainerId: string | null;
    trainerName: string | null;
    trainerFirstName: string | null;
    trainerLastName: string | null;
    trainerEmail: string | null;
  }) => void;
  disabled?: boolean;
  trainers?: Trainer[];
}

const OTHER_VALUE = '__other__';

export default function TrainerSelect({
  trainerId,
  trainerName,
  trainerFirstName,
  trainerLastName,
  trainerEmail,
  onChange,
  disabled,
  trainers: initialTrainers,
}: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers ?? []);
  const [loading, setLoading] = useState(!initialTrainers);
  const [selection, setSelection] = useState('');
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualEmail, setManualEmail] = useState(trainerEmail ?? '');

  const splitName = (value: string | null | undefined) => {
    const name = (value ?? '').trim();
    const [first = '', ...rest] = name.split(/\s+/);
    return { first, last: rest.join(' ') };
  };

  const emitOther = (firstName: string, lastName: string, email: string) => {
    const first = firstName.trim();
    const last = lastName.trim();
    const emailValue = email.trim();
    onChange({
      trainerId: null,
      trainerName: first && last ? `${first} ${last}` : null,
      trainerFirstName: first || null,
      trainerLastName: last || null,
      trainerEmail: emailValue || null,
    });
  };

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
      setManualFirstName('');
      setManualLastName('');
      setManualEmail('');
      return;
    }
    if (trainerName || trainerFirstName || trainerLastName || trainerEmail) {
      const { first, last } = splitName(trainerName);
      setSelection(OTHER_VALUE);
      setManualFirstName(trainerFirstName ?? first);
      setManualLastName(trainerLastName ?? last);
      setManualEmail(trainerEmail ?? '');
      return;
    }
    setSelection('');
    setManualFirstName('');
    setManualLastName('');
    setManualEmail('');
  }, [trainerId, trainerName, trainerFirstName, trainerLastName, trainerEmail]);

  const isOther = useMemo(() => selection === OTHER_VALUE, [selection]);

  const handleSelectChange = (value: string) => {
    setSelection(value);

    if (!value) {
      setManualFirstName('');
      setManualLastName('');
      setManualEmail('');
      onChange({ trainerId: null, trainerName: null, trainerFirstName: null, trainerLastName: null, trainerEmail: null });
      return;
    }
    if (value === OTHER_VALUE) {
      const { first, last } = splitName(trainerName);
      const nextFirst = trainerFirstName ?? (first || manualFirstName);
      const nextLast = trainerLastName ?? (last || manualLastName);
      const nextEmail = trainerEmail ?? manualEmail;
      setManualFirstName(nextFirst);
      setManualLastName(nextLast);
      setManualEmail(nextEmail);
      emitOther(nextFirst, nextLast, nextEmail);
      return;
    }

    setManualFirstName('');
    setManualLastName('');
    setManualEmail('');
    onChange({ trainerId: value, trainerName: null, trainerFirstName: null, trainerLastName: null, trainerEmail: null });
  };

  const handleManualFirstNameChange = (value: string) => {
    setManualFirstName(value);
    emitOther(value, manualLastName, manualEmail);
  };

  const handleManualLastNameChange = (value: string) => {
    setManualLastName(value);
    emitOther(manualFirstName, value, manualEmail);
  };

  const handleManualEmailChange = (value: string) => {
    setManualEmail(value);
    emitOther(manualFirstName, manualLastName, value);
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

  const inputStyle = { borderColor: '#d4b896', backgroundColor: '#faf7f2' } as const;

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
        {trainers.map((trainer) => (
          <option key={trainer.id} value={trainer.id}>
            {trainer.name}
          </option>
        ))}
        <option value={OTHER_VALUE}>Other - enter trainer details</option>
      </select>

      {isOther && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={manualFirstName}
            onChange={(e) => handleManualFirstNameChange(e.target.value)}
            placeholder="Trainer first name *"
            disabled={disabled}
            className="w-full border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
          <input
            type="text"
            value={manualLastName}
            onChange={(e) => handleManualLastNameChange(e.target.value)}
            placeholder="Trainer last name *"
            disabled={disabled}
            className="w-full border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
          <input
            type="email"
            value={manualEmail}
            onChange={(e) => handleManualEmailChange(e.target.value)}
            placeholder="Trainer email *"
            disabled={disabled}
            className="w-full border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
          <p className="text-xs" style={{ color: '#8b7355' }}>
            First name, last name, and email are required. If this trainer is already in the registry, those three fields will link this horse to the existing trainer.
          </p>
        </div>
      )}
    </div>
  );
}
