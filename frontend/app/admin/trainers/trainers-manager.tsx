'use client';

import Link from 'next/link';
import { trainerSubscriptionHref } from '@/lib/subscriptions';
import { useMemo, useState } from 'react';

interface Trainer {
  id: string;
  user_id: string | null;
  name: string;
  private_phone: string | null;
  phone: string | null;
  email: string | null;
  user_email: string | null;
  horse_count: number;
  created_at: string;
  is_public: boolean;
  is_pro: boolean;
  pro_request_plan: 'monthly' | 'annual' | null;
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'accent' | 'warning' | 'muted' }) {
  const style =
    tone === 'accent'
      ? { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }
      : tone === 'warning'
      ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)', border: '1px solid var(--warning-border)' }
      : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)', border: '1px solid var(--border)' };
  return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={style}>{children}</span>;
}

interface Props {
  initialTrainers: Trainer[];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrainersManager({ initialTrainers }: Props) {
  const [trainers, setTrainers] = useState<Trainer[]>(initialTrainers);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(() => [...trainers].sort((a, b) => a.name.localeCompare(b.name)), [trainers]);

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/trainers/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setTrainers((prev) => prev.filter((t) => t.id !== id));
      setConfirmDeleteId(null);
      return;
    }
    const err = await res.json().catch(() => ({}));
    setError(err.detail ?? 'Failed to delete trainer.');
  };

  return (
    <div className="space-y-6">
      {/* No Add Trainer (2026-11-13): a trainer exists because they signed up.
          A row typed in here, like one typed in from a horse form, was a trainer
          who had never seen GaitDesk, so neither is offered any more. */}
      <section className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Trainers</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          A trainer is added by signing up for their own trainer account at{' '}
          <Link href="/register/trainer" className="underline" style={{ color: 'var(--accent)' }}>/register/trainer</Link>.
          Only trainers with an account can be picked on a horse; a trainer shown as <em>Not linked</em> below
          was typed in before that and stays on the horses that already name them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>All Trainers ({sorted.length})</h2>
        {sorted.some((t) => t.pro_request_plan) && (
          <p className="text-sm" style={{ color: 'var(--warning-strong)' }}>
            {sorted.filter((t) => t.pro_request_plan).length} asking for Trainer Registry Pro —{' '}
            <Link href="/admin/subscriptions?tab=trainers" className="underline">answer at Manage Subscriptions</Link>.
          </p>
        )}
        {sorted.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No trainers yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((trainer) => (
              <li key={trainer.id} className="border rounded p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium flex items-center gap-2 flex-wrap" style={{ color: 'var(--foreground)' }}>
                      {trainer.name}
                      {trainer.is_public && <Tag tone="muted">Listed</Tag>}
                      {trainer.is_pro && <Tag tone="accent">Pro</Tag>}
                      {trainer.pro_request_plan && <Tag tone="warning">Asked for Pro</Tag>}
                    </p>
                    <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1" style={{ color: 'var(--text-deep)' }}>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Public phone:</dt>
                        <dd className="inline">{trainer.phone || <span style={{ color: 'var(--muted)' }}>—</span>}</dd>
                      </div>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Public email:</dt>
                        <dd className="inline">{trainer.email || <span style={{ color: 'var(--muted)' }}>—</span>}</dd>
                      </div>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Private phone:</dt>
                        <dd className="inline">{trainer.private_phone || <span style={{ color: 'var(--muted)' }}>—</span>}</dd>
                      </div>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>User account:</dt>
                        <dd className="inline">
                          {trainer.user_id ? (
                            <Link href={`/admin/users/${trainer.user_id}`} className="underline" style={{ color: 'var(--accent)' }}>
                              {trainer.user_email ?? 'View user'}
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>Not linked</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Horses:</dt>
                        <dd className="inline">{trainer.horse_count}</dd>
                      </div>
                      <div>
                        <dt className="inline text-xs uppercase tracking-wide mr-1" style={{ color: 'var(--muted)' }}>Created:</dt>
                        <dd className="inline">{formatDate(trainer.created_at)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Link href={trainerSubscriptionHref(trainer.id)} className="text-sm font-medium underline" style={{ color: 'var(--accent)' }}>
                      Manage subscription
                    </Link>
                    <Link href={`/admin/trainers/${trainer.id}`} className="text-sm font-medium underline" style={{ color: 'var(--accent)' }}>
                      Manage
                    </Link>
                    {confirmDeleteId === trainer.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>Delete?</span>
                        <button onClick={() => handleDelete(trainer.id)} className="text-xs text-red-600 hover:underline">Yes</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(trainer.id)} className="text-sm text-red-600">Delete</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
