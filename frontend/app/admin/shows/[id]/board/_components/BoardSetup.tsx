'use client';

import { useState } from 'react';
import Link from 'next/link';
import { openOnSecondScreen, type SecondScreenResult } from './second-screen';
import { PRESETS, SIZE_ORDER, type SizeKey } from './units';

/* A board's own page — reached from Live Screens, and where the board opens
   onto when it is not running: how big the panel is, and whatever else that
   board needs answered before it runs.

   Same dark panel as the boards and sized off `vh` like them, because it is
   usually opened on the TV's own browser — but it scrolls, and every size has
   a px floor, because a setting is as likely to be changed from a phone in the
   office while a board runs somewhere else. */

export function HubHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: '1.4vh' }}>
      <h2 className="font-bold" style={{ fontSize: 'max(18px, 2.8vh)', color: 'var(--on-slate)' }}>
        {title}
      </h2>
      {note && (
        <p
          style={{
            fontSize: 'max(13px, 1.8vh)',
            color: 'var(--on-slate-muted)',
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** The page around a board's settings: its name, the show, the way back to
 *  Live Screens, and anything the office should know first. */
export function BoardSetupPage({
  showId,
  showName,
  title,
  notice,
  children,
}: {
  showId: string;
  showName: string;
  /** Which board this page starts. */
  title: string;
  /** Something the office should know before putting this board up. */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex flex-col" style={{ maxWidth: '150vh', padding: '4vh 16px', gap: '3.6vh' }}>
        <header className="flex items-end justify-between flex-wrap" style={{ gap: '1.4vh' }}>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: 'max(24px, 4.2vh)', color: 'var(--on-slate)' }}>
              {title}
            </h1>
            <p className="truncate" style={{ fontSize: 'max(14px, 2vh)', color: 'var(--on-slate-muted)' }}>
              {showName}
            </p>
          </div>
          <Link
            href={`/admin/shows/${showId}/board`}
            className="hover:underline"
            style={{ fontSize: 'max(14px, 1.9vh)', color: 'var(--accent-light)' }}
          >
            ← Live Screens
          </Link>
        </header>

        {notice && (
          <p
            role="status"
            className="rounded-lg"
            style={{
              fontSize: 'max(14px, 1.9vh)',
              padding: '1.4vh 1.8vh',
              backgroundColor: 'var(--slate-raised)',
              border: '0.2vh solid var(--warning)',
              color: 'var(--on-slate)',
            }}
          >
            {notice}
          </p>
        )}

        {children}
      </div>
    </div>
  );
}

/** The two-way choice a board's page asks with a row of buttons. */
export function segmentStyle(on: boolean) {
  return {
    fontSize: 'max(14px, 1.9vh)',
    padding: '0.9vh 1.6vh',
    backgroundColor: on ? 'var(--accent)' : 'var(--slate-raised)',
    color: on ? 'var(--accent-foreground)' : 'var(--on-slate-muted)',
    border: '0.2vh solid var(--on-slate-muted)',
  } as const;
}

/**
 * Where the board goes, and how big that screen is — the question every board
 * starts on.
 *
 * The size question is worded as where the screen is and how far away the
 * reader stands, not as a diagonal: nobody setting up a lobby TV knows whether
 * it is 58" or 65", and the distance is what actually decides the layout.
 *
 * **Or on a monitor plugged in**, duplicated or extended — see
 * second-screen.ts. Extended, a laptop or tablet with a TV plugged in does not
 * have to give its own screen up to the board: choosing *Extend screen* opens
 * the board in a window of its own on the attached monitor
 * (`openOnSecondScreen`), and this page stays here, free for the desk.
 */
export function ScreenPicker({
  windowName,
  initialDuplicate,
  onPick,
  blocked = null,
}: {
  /** The board's own window name — see `openOnSecondScreen`. */
  windowName: string;
  /** Reached through the Settings of a duplicated board. */
  initialDuplicate: boolean;
  onPick: (k: SizeKey, duplicate: boolean) => void;
  /** Why the board cannot start yet, when something above still needs an
   *  answer. The sizes are offered but greyed out with this as their title. */
  blocked?: string | null;
}) {
  const card = {
    padding: '2.4vh',
    backgroundColor: 'var(--slate-raised)',
    border: '0.2vh solid var(--on-slate-muted)',
    color: 'var(--on-slate)',
  } as const;

  const [target, setTarget] = useState<'here' | 'duplicate' | 'second'>(initialDuplicate ? 'duplicate' : 'here');
  const [opened, setOpened] = useState<SecondScreenResult | null>(null);

  const pick = async (key: SizeKey) => {
    if (blocked) return;
    if (target !== 'second') {
      onPick(key, target === 'duplicate');
      return;
    }
    // The screen time and anything else in the query travel with the board.
    const q = new URLSearchParams(window.location.search);
    q.set('size', key);
    q.set('popout', '1');
    q.delete('duplicate');
    setOpened(await openOnSecondScreen(`${window.location.pathname}?${q.toString()}`, windowName));
  };

  const openedNote =
    opened == null
      ? null
      : opened.kind === 'blocked'
        ? 'The browser blocked the board’s window. Allow pop-ups for this site, then pick the size again.'
        : opened.kind === 'placed'
          ? `The board is running on ${opened.screen ? `“${opened.screen}”` : 'the second screen'}. Move the mouse onto it and press Fill this screen. This one stays free — close the board’s window to stop it.`
          : opened.reason === 'no-second-screen'
            ? 'No second screen was found, so the board opened in a window here. Check the display is set to extend, not mirror, then drag the window across and press Fill this screen.'
            : 'The board opened in its own window. Drag it onto the second screen and press Fill this screen — this one stays free.';

  const targets = [
    { key: 'here', label: 'This screen', title: undefined },
    {
      key: 'duplicate',
      label: 'Duplicate screen',
      title:
        'A monitor showing the same picture as this tablet or laptop. The board fills this screen, so it fills the monitor too.',
    },
    {
      key: 'second',
      label: 'Extend screen',
      title:
        'A TV or monitor plugged into this laptop or tablet. The board gets its own window there, and this screen stays free.',
    },
  ] as const;

  return (
    <section>
      <HubHeading
        title="Where is this screen?"
        note="A browser is never told how big its screen is, and a lobby TV needs letters several times taller than a desk monitor. Pick one and the board starts."
      />
      <div
        className="flex flex-wrap items-center"
        style={{ gap: '1vh', marginBottom: '2vh' }}
        role="group"
        aria-label="Which screen shows the board"
      >
        {targets.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTarget(t.key);
              setOpened(null);
            }}
            aria-pressed={target === t.key}
            className="rounded-lg font-semibold"
            style={segmentStyle(target === t.key)}
            title={t.title}
          >
            {t.label}
          </button>
        ))}
        {target !== 'here' && (
          <span style={{ fontSize: 'max(13px, 1.7vh)', color: 'var(--on-slate-muted)' }}>
            {target === 'duplicate'
              ? 'The monitor shows the same picture as this tablet or laptop. Pick the monitor’s size below.'
              : 'The one plugged into this laptop or tablet, set to extend the display.'}
          </span>
        )}
      </div>
      {openedNote && (
        <p
          role="status"
          className="rounded-lg"
          style={{
            fontSize: 'max(14px, 1.9vh)',
            padding: '1.2vh 1.6vh',
            marginBottom: '2vh',
            backgroundColor: 'var(--slate-raised)',
            color: opened?.kind === 'blocked' ? 'var(--warning)' : 'var(--on-slate)',
          }}
        >
          {openedNote}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: '2vh' }}>
        {SIZE_ORDER.map((key, i) => {
          const p = PRESETS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => void pick(key)}
              disabled={blocked != null}
              title={blocked ?? undefined}
              className="rounded-xl text-left transition hover:brightness-125 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
              style={card}
            >
              <div style={{ fontSize: 'max(28px, 4.4vh)' }} aria-hidden>
                {p.icon}
              </div>
              <div className="font-bold" style={{ fontSize: 'max(18px, 2.6vh)', marginTop: '0.8vh' }}>
                {p.label}
              </div>
              <div style={{ fontSize: 'max(14px, 2vh)', color: 'var(--accent-light)' }}>{p.inches}</div>
              <div style={{ fontSize: 'max(13px, 1.8vh)', marginTop: '0.6vh', color: 'var(--on-slate-muted)' }}>
                {p.distance}
              </div>
              <div style={{ fontSize: 'max(13px, 1.7vh)', marginTop: '1.1vh', color: 'var(--on-slate-muted)' }}>
                {p.blurb}
              </div>
              <div style={{ fontSize: 'max(12px, 1.5vh)', marginTop: '1.1vh', color: 'var(--on-slate-muted)' }}>
                {/* The number keys start the board on this screen, never
                    duplicated or on the second screen. */}
                {blocked
                  ? blocked
                  : target === 'here'
                    ? `Press ${i + 1}`
                    : target === 'duplicate'
                      ? 'Fills this screen and the monitor'
                      : 'Opens on the second screen'}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
