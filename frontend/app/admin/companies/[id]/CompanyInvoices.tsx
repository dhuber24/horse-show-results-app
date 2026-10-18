'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { INVOICE_STATUS_LABEL, formatCents, type GaitDeskInvoice, type SettleUp } from '@/lib/payments';
import { formatDay } from '@/lib/show-companies';

const METHODS = [
  { key: 'check', label: 'Check' },
  { key: 'wire', label: 'Wire' },
  { key: 'ach', label: 'Bank transfer (ACH)' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
] as const;

const STATUS_STYLE: Record<GaitDeskInvoice['status'], { backgroundColor: string; color: string }> = {
  open: { backgroundColor: 'var(--accent-bg)', color: 'var(--accent-hover)' },
  overdue: { backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' },
  processing: { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' },
  paid: { backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' },
  void: { backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' },
};

const smallButton = 'text-xs font-medium px-2.5 py-1 rounded border disabled:opacity-50';
const smallStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

function InvoiceItem({
  companyId,
  invoice,
  onChange,
}: {
  companyId: string;
  invoice: GaitDeskInvoice;
  onChange: (updated: GaitDeskInvoice) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'pay' | 'void'>('idle');
  const [method, setMethod] = useState<string>('check');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = invoice.status === 'open' || invoice.status === 'overdue';
  const base = `/api/show-companies/${companyId}/invoices/${invoice.id}`;

  const send = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setError(errorMessage(json, 'That did not save. Try again.'));
      return;
    }
    setMode('idle');
    onChange(json as GaitDeskInvoice);
  };

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{invoice.label}</span>
          <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
            Issued {formatDay(invoice.issued_on)} · due {formatDay(invoice.due_on)} · {invoice.lines.length} line
            {invoice.lines.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
            {formatCents(invoice.amount_cents)}
          </span>
          <span className="text-xs font-medium rounded px-2 py-0.5" style={STATUS_STYLE[invoice.status]}>
            {INVOICE_STATUS_LABEL[invoice.status]}
          </span>
        </div>
      </div>
      <ul className="text-xs pl-3 space-y-0.5" style={{ color: 'var(--text-deep)' }}>
        {invoice.lines.map((line) => (
          <li key={line.id}>
            {line.description}: {formatCents(line.amount_cents)}
          </li>
        ))}
      </ul>
      {invoice.status === 'paid' && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Paid {formatDay(invoice.paid_on)} by {invoice.payment_method}
          {invoice.payment_reference ? ` — ${invoice.payment_reference}` : ''}
          {invoice.card_fee_cents > 0 ? ` · card fee ${formatCents(invoice.card_fee_cents)} paid on top` : ''}
        </p>
      )}
      {open && mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} style={smallStyle} onClick={() => setMode('pay')}>
            Mark paid
          </button>
          <button type="button" className={smallButton} style={{ ...smallStyle, color: 'var(--error-strong)' }} onClick={() => setMode('void')}>
            Void
          </button>
        </div>
      )}
      {open && mode === 'pay' && (
        <div className="flex flex-wrap items-end gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <label>
            Paid by
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="block mt-1 border rounded px-2 py-1 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            >
              {METHODS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            Reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
              placeholder="Check number"
              className="block mt-1 border rounded px-2 py-1 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            />
          </label>
          <label>
            Received
            <input
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="block mt-1 border rounded px-2 py-1 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            />
          </label>
          <button
            type="button"
            className={smallButton}
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)', borderColor: 'var(--accent)' }}
            disabled={busy}
            title={busy ? 'Saving…' : undefined}
            onClick={() => send(`${base}/payment`, { method, reference: reference.trim() || null, paid_on: paidOn || null })}
          >
            {busy ? 'Saving…' : 'Record payment'}
          </button>
          <button type="button" className={smallButton} style={smallStyle} disabled={busy} title={busy ? 'Saving…' : undefined} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </div>
      )}
      {open && mode === 'void' && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--error-strong)' }}>
          <span>Void {invoice.label}? Its shows and Pro+ years can then be invoiced again.</span>
          <button
            type="button"
            className={smallButton}
            style={{ ...smallStyle, color: 'var(--error-strong)' }}
            disabled={busy}
            title={busy ? 'Voiding…' : undefined}
            onClick={() => send(`${base}/void`, {})}
          >
            {busy ? 'Voiding…' : 'Yes, void it'}
          </button>
          <button type="button" className={smallButton} style={smallStyle} disabled={busy} title={busy ? 'Voiding…' : undefined} onClick={() => setMode('idle')}>
            Keep it
          </button>
        </div>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--error-strong)' }}>{error}</p>}
    </li>
  );
}

/**
 * GaitDesk's invoices to this company (migration 172): issued from the usage
 * statement above, paid online by the company on My Company, or marked paid
 * here for a check or wire. Voiding frees an invoice's lines to be invoiced
 * again, so it tells the page to re-read the statement.
 */
export default function CompanyInvoices({
  companyId,
  refreshKey,
  onChange,
}: {
  companyId: string;
  refreshKey: number;
  onChange: () => void;
}) {
  const [invoices, setInvoices] = useState<GaitDeskInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the company is held back from setting up a show (migration 173).
  // Marking the invoice for those shows paid releases it.
  const [settleUp, setSettleUp] = useState<SettleUp | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/show-companies/${companyId}/settle-up`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (live && res.ok) setSettleUp(body as SettleUp);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [companyId, refreshKey]);

  useEffect(() => {
    let live = true;
    fetch(`/api/show-companies/${companyId}/invoices`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok) setInvoices(body as GaitDeskInvoice[]);
        else setError(errorMessage(body, 'The invoices could not be loaded.'));
      })
      .catch(() => live && setError('The invoices could not be loaded.'));
    return () => {
      live = false;
    };
  }, [companyId, refreshKey]);

  return (
    <section className="p-5 rounded-lg border space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>Invoices</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Net 30. The company pays on My Company — by bank transfer, or by card with the processing fee added — or
          mark a check or wire paid here.
        </p>
      </div>
      {settleUp?.blocked && (
        <div
          role="status"
          className="rounded border p-3 text-sm space-y-1"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
        >
          <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Can&apos;t set up new shows until paid</p>
          <p>
            {settleUp.shows.map((s) => `${s.show_name} (${formatCents(s.amount_cents)}${s.invoice_label ? `, ${s.invoice_label}` : ', not invoiced yet'})`).join('; ')}
            . Marking the invoice paid lets them set up their next show.
          </p>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
      ) : !invoices ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No invoices yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {invoices.map((invoice) => (
            <InvoiceItem
              key={invoice.id}
              companyId={companyId}
              invoice={invoice}
              onChange={(updated) => {
                setInvoices((list) => (list ?? []).map((i) => (i.id === updated.id ? updated : i)));
                onChange();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
