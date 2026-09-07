'use client';

import { useState } from 'react';
import {
  cardDivisionLabel,
  cardDivisionsFor,
  cardStanding,
  issuesCards,
  type CardStanding,
} from '@/lib/competition-cards';

export interface CompetitionCard {
  id: string;
  association_id: string;
  association_code: string;
  association_name: string;
  division: string;
  division_label: string;
  valid_year: number;
  card_number: string | null;
  /** Derived by the backend — 31 December of `valid_year`. Never typed in. */
  expires_at: string;
}

interface Membership {
  association_id: string;
  association_code: string;
  association_name: string;
}

interface Props {
  exhibitorId: string;
  initialCards: CompetitionCard[];
  /**
   * The associations this exhibitor already holds a membership with. A
   * competition card is issued *to a member*, so there is nothing to offer
   * somebody who has not filed the membership it hangs off — and offering the
   * card first would collect a number the show office cannot check against
   * anything.
   */
  memberships: Membership[];
}

const STANDING_STYLE: Record<CardStanding, { color: string; label: string }> = {
  current:  { color: 'var(--success-strong)', label: 'Current' },
  expiring: { color: 'var(--warning)', label: 'Expires soon' },
  expired:  { color: 'var(--error)', label: 'Expired' },
};

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ExhibitorCompetitionCards({ exhibitorId, initialCards, memberships }: Props) {
  const [cards, setCards] = useState<CompetitionCard[]>(initialCards);
  const thisYear = new Date().getFullYear();
  const [newCard, setNewCard] = useState({ association_id: '', division: '', valid_year: String(thisYear), card_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Only bodies whose card rules the app actually holds. An association absent
  // from the map issues no card this app can describe, which is a different
  // claim from issuing none — so the empty state says so rather than implying
  // the exhibitor has nothing to file.
  const cardIssuers = memberships.filter((m) => issuesCards(m.association_code));
  const selectedIssuer = cardIssuers.find((m) => m.association_id === newCard.association_id) ?? null;
  const held = new Set(cards.map((c) => `${c.association_id}:${c.division}`));
  const availableDivisions = selectedIssuer
    ? cardDivisionsFor(selectedIssuer.association_code).filter((d) => !held.has(`${selectedIssuer.association_id}:${d}`))
    : [];

  const handleAdd = async () => {
    if (!newCard.association_id || !newCard.division) {
      setError('Pick an association and the division the card is for.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/competition-cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        association_id: newCard.association_id,
        division: newCard.division,
        valid_year: Number(newCard.valid_year),
        card_number: newCard.card_number.trim() || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const created: CompetitionCard = await res.json();
      setCards((prev) => [...prev, created]);
      setNewCard({ association_id: '', division: '', valid_year: String(thisYear), card_number: '' });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to save the card.');
    }
  };

  /** Renewing is raising the year. That is the entire annual renewal. */
  const handleRenew = async (card: CompetitionCard, year: number) => {
    setRenewingId(card.id);
    setError(null);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/competition-cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid_year: year }),
    });
    setRenewingId(null);
    if (res.ok) {
      const updated: CompetitionCard = await res.json();
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to renew the card.');
    }
  };

  const handleDelete = async (cardId: string) => {
    setDeletingId(cardId);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/competition-cards/${cardId}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.ok || res.status === 204) {
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    }
    setConfirmDeleteId(null);
  };

  return (
    <div className="rounded-lg border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Competition Cards</h2>
      {/* One short line on the screen; the citation rides on the title, where
          it costs nobody a line of a phone screen. */}
      <p
        className="text-sm mb-4"
        style={{ color: 'var(--muted)' }}
        title='APHA: "Amateur cards run January 1–December 31 and must be renewed annually." Novice Amateur, Amateur Walk-Trot, Novice Youth and Youth Walk-Trot 11–18 cards expire the same day.'
      >
        Amateur, Novice and Walk-Trot cards run to 31 December and are renewed every year.
      </p>

      {cards.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No competition cards on file.</p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => {
            const standing = cardStanding(card.valid_year);
            const style = STANDING_STYLE[standing];
            const canRenew = card.valid_year <= thisYear;
            return (
              <li
                key={card.id}
                className="rounded-lg border p-3 space-y-2"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--background)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-sm font-semibold mr-2" style={{ color: 'var(--accent)' }}>
                      {card.association_code}
                    </span>
                    <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                      {card.division_label || cardDivisionLabel(card.division)}
                    </span>
                    {card.card_number && (
                      <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>#{card.card_number}</span>
                    )}
                  </div>
                  {confirmDeleteId === card.id ? (
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs" style={{ color: 'var(--text-deep)' }}>Remove?</span>
                      <button onClick={() => handleDelete(card.id)} disabled={deletingId === card.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">
                        {deletingId === card.id ? 'Removing…' : 'Yes'}
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)}
                        className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(card.id)}
                      className="text-xs text-red-600 hover:text-red-800 shrink-0">Remove</button>
                  )}
                </div>

                <div className="border-t pt-2 flex items-center justify-between flex-wrap gap-2" style={{ borderColor: 'var(--bg-subtle)' }}>
                  <span className="text-xs" style={{ color: style.color }}>
                    {card.valid_year} card — {style.label}, expires {formatDate(card.expires_at)}
                  </span>
                  {canRenew && (
                    <button
                      onClick={() => handleRenew(card, thisYear + 1)}
                      disabled={renewingId === card.id}
                      className="text-xs font-medium hover:underline disabled:opacity-50"
                      style={{ color: 'var(--accent)' }}
                      title={`Record that this card has been renewed for ${thisYear + 1}`}
                    >
                      {renewingId === card.id ? 'Renewing…' : `Renew for ${thisYear + 1}`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cardIssuers.length === 0 ? (
        <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
          Add an APHA membership above and any Amateur, Novice or Walk-Trot cards you hold can be recorded here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 items-end pt-3">
          <div className="flex-1 min-w-[120px]">
            <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Association</label>
            <select
              value={newCard.association_id}
              onChange={(e) => setNewCard((p) => ({ ...p, association_id: e.target.value, division: '' }))}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Association…</option>
              {cardIssuers.map((m) => (
                <option key={m.association_id} value={m.association_id}>{m.association_code}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Card</label>
            <select
              value={newCard.division}
              onChange={(e) => setNewCard((p) => ({ ...p, division: e.target.value }))}
              disabled={!selectedIssuer}
              className="w-full border rounded px-3 py-2 text-sm disabled:opacity-50"
              title={selectedIssuer ? undefined : 'Pick an association first'}
            >
              <option value="">Card…</option>
              {availableDivisions.map((d) => (
                <option key={d} value={d}>{cardDivisionLabel(d)}</option>
              ))}
            </select>
          </div>
          {/* A year, not a date: every one of these cards expires 31 December,
              so a date box could only be typed wrong. */}
          <div className="min-w-[100px]">
            <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Card year</label>
            <input
              type="number"
              value={newCard.valid_year}
              min={thisYear - 5}
              max={thisYear + 1}
              onChange={(e) => setNewCard((p) => ({ ...p, valid_year: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
              title="The competition year the card is good for. It expires 31 December of that year."
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Card number</label>
            <input
              value={newCard.card_number}
              onChange={(e) => setNewCard((p) => ({ ...p, card_number: e.target.value }))}
              placeholder="Optional"
              className="w-full border rounded px-3 py-2 text-sm"
              title="Only if it differs from your association membership number — an APHA amateur card carries your own APHA number."
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || availableDivisions.length === 0}
            className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
            title={availableDivisions.length === 0 && selectedIssuer ? 'Every card this association issues is already on file' : undefined}
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
