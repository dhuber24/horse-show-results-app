'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import QrCode from '@/components/QrCode';
import type { FillPromptText } from './second-screen';
import { PRESETS, SIZE_ORDER, U_VH, c, u, type Preset, type SizeKey } from './units';

/** The full-screen dark panel a board and its page both live in. The cursor
 *  hides only over a running board: the board's page is a page somebody is
 *  using, with buttons and text boxes on it. */
export function BoardRoot({
  running,
  chrome,
  onMouseMove,
  children,
}: {
  running: boolean;
  chrome: boolean;
  onMouseMove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        backgroundColor: 'var(--slate)',
        cursor: running && !chrome ? 'none' : 'auto',
      }}
      onMouseMove={onMouseMove}
    >
      {children}
    </div>
  );
}

/** A running board: the preset's two units, the inset for TV overscan, and the
 *  drift. Everything inside sizes itself off --u and --uc. */
export function BoardCanvas({ preset, children }: { preset: Preset; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={
        {
          '--u': `${(preset.scale * U_VH).toFixed(3)}vh`,
          '--uc': `${(preset.scale * preset.chrome * U_VH).toFixed(3)}vh`,
          padding: `${preset.safe}%`,
          // A board runs ten hours a day on a panel that may well be OLED.
          // A slow wander of a few pixels keeps the static furniture — the
          // show name, the ticker rule — off one fixed set of them.
          animation: 'board-drift 1200s ease-in-out infinite',
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** Asks for full screen on a board that is on a monitor of its own and is not
 *  — big, because on an extended screen it is being reached for with a mouse
 *  dragged over from the laptop. Duplicated, it comes up after Esc or a
 *  reload, with whoever did that at the keyboard. */
export function FillPrompt({
  text,
  onFill,
  onKeep,
}: {
  text: FillPromptText;
  onFill: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center"
      style={{ backgroundColor: 'var(--slate)', gap: '2vh', padding: '0 16px' }}
    >
      <button
        type="button"
        onClick={onFill}
        className="rounded-2xl font-bold transition hover:brightness-110"
        style={{
          fontSize: 'max(24px, 4.5vh)',
          padding: '3vh 6vh',
          backgroundColor: 'var(--accent)',
          color: 'var(--accent-foreground)',
        }}
      >
        {text.button}
      </button>
      <p style={{ fontSize: 'max(14px, 2vh)', color: 'var(--on-slate-muted)' }}>{text.note}</p>
      <button
        type="button"
        onClick={onKeep}
        className="hover:underline"
        style={{ fontSize: 'max(13px, 1.7vh)', color: 'var(--accent-light)' }}
      >
        {text.keep}
      </button>
    </div>
  );
}

/** What the corner of the header says about the board itself. */
export type BoardStatus = 'live' | 'paused' | 'offline';

function StatusMark({ status }: { status: BoardStatus }) {
  if (status === 'paused') {
    return (
      <span className="font-semibold tracking-wider" style={{ fontSize: c(1.1), color: 'var(--warning)' }}>
        ❙❙ PAUSED
      </span>
    );
  }
  if (status === 'offline') {
    // Said, not hidden: a board read from across a room cannot be refreshed
    // by the people reading it, and one that quietly stopped updating sends
    // somebody to the gate for a class that has already gone.
    return (
      <span
        className="font-semibold tracking-wider"
        style={{ fontSize: c(1.1), color: 'var(--warning)' }}
        title="The board could not reach the server on its last try, so what it shows may be out of date"
      >
        ⚠ NOT UPDATING
      </span>
    );
  }
  return (
    <>
      <span className="relative flex" style={{ width: c(0.55), height: c(0.55) }}>
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ backgroundColor: 'var(--accent-light)' }}
        />
        <span className="relative inline-flex rounded-full h-full w-full" style={{ backgroundColor: 'var(--accent-light)' }} />
      </span>
      <span className="font-semibold tracking-wider" style={{ fontSize: c(1.1), color: 'var(--accent-light)' }}>
        LIVE
      </span>
    </>
  );
}

/** The time of day, in the reader's own zone — the board only renders once
 *  mounted, so this never formats on the server. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tabular-nums" style={{ fontSize: c(1.25), marginLeft: c(0.4), color: 'var(--on-slate-muted)' }}>
      {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </span>
  );
}

/** A board's header: the mark that leads back to the show, which show (and
 *  for the gate board which ring), whether the board is live, the clock, and
 *  optionally a QR code to the public page that carries the rest. */
export function BoardHeader({
  showId,
  title,
  subtitle,
  status,
  qr,
}: {
  showId: string;
  title: string;
  subtitle?: string | null;
  status: BoardStatus;
  qr?: { value: string; caption: string; label: string };
}) {
  const statusRow = (
    <div className="flex items-center" style={{ gap: c(0.5) }}>
      <StatusMark status={status} />
      <Clock />
    </div>
  );

  return (
    <header
      className="flex items-center justify-between flex-none"
      style={{
        paddingInline: c(1.8),
        paddingTop: c(0.6),
        paddingBottom: c(0.7),
      }}
    >
      {/* The way back out of a full-screen board with no chrome. It goes to
          the show's admin console rather than the public hub, because the only
          person who can be looking at this is the one who put it up.

          The mark plus the separate 4:1 wordmark, which is the pairing the
          navbar uses and for the same reason: the full lockup's minimum is
          180px wide, and this header's whole job is to stay out of the way of
          the board. Sized by **width** off the chrome unit, so it gives space
          back at the lobby scale like everything else here — with a px floor
          under each, because the brand minimums (48px mark, 120px wordmark)
          are the point below which the mane strokes and the tagline close up,
          and a unit that scales does not know about them. */}
      <Link
        href={`/admin/shows/${showId}`}
        className="opacity-60 hover:opacity-100 transition flex-none flex items-center"
        style={{ gap: c(0.5) }}
        aria-label="GaitDesk — back to this show's console"
      >
        <Image
          src="/brand/gaitdesk-mark-on-dark-256w.png"
          alt=""
          aria-hidden="true"
          width={256}
          height={360}
          priority
          style={{ width: `max(48px, ${c(2.4)})`, height: 'auto' }}
        />
        <Image
          src="/brand/gaitdesk-wordmark-on-dark-400w.png"
          alt="GaitDesk"
          width={400}
          height={100}
          priority
          style={{ width: `max(120px, ${c(6)})`, height: 'auto' }}
        />
      </Link>

      <div className="text-center min-w-0" style={{ paddingInline: c(1) }}>
        <div className="font-bold truncate" style={{ fontSize: c(1.9), color: 'var(--on-slate)' }}>
          {title}
        </div>
        {subtitle && (
          <div className="truncate" style={{ fontSize: c(1.05), color: 'var(--on-slate-muted)' }}>
            {subtitle}
          </div>
        )}
      </div>

      {qr ? (
        <div className="flex items-center flex-none" style={{ gap: c(1) }}>
          <div className="flex flex-col items-end" style={{ gap: c(0.4) }}>
            {statusRow}
            <div
              className="text-right whitespace-nowrap"
              style={{ fontSize: c(0.9), lineHeight: 1.25, color: 'var(--on-slate-muted)' }}
            >
              {qr.caption}
            </div>
          </div>
          {/* Sized off the chrome unit like the rest of the header, with a
              floor below which a phone at arm's length stops finding it. */}
          <QrCode value={qr.value} size={`max(88px, ${c(5.6)})`} label={qr.label} />
        </div>
      ) : (
        <div className="flex-none">{statusRow}</div>
      )}
    </header>
  );
}

/** Where the stage has nothing to show yet. */
export function BoardNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
      <div className="font-semibold" style={{ fontSize: u(3), color: 'var(--on-slate)' }}>
        {title}
      </div>
      <p
        style={{
          fontSize: u(1.6),
          marginTop: u(0.8),
          maxWidth: u(34),
          color: 'var(--on-slate-muted)',
        }}
      >
        {children}
      </p>
    </div>
  );
}

/** A button in the board's fade-in controls. */
export const CONTROL_BUTTON = {
  fontSize: c(0.85),
  padding: `${c(0.25)} ${c(0.6)}`,
  color: 'var(--on-slate-muted)',
} as const;

/** The hairline between groups of controls. */
export function ControlRule() {
  return <span style={{ width: c(0.06), height: c(1.2), backgroundColor: 'var(--on-slate-muted)', opacity: 0.4 }} />;
}

/** The setup controls, there for whoever is standing at the screen with a
 *  mouse and invisible the rest of the time: back to the board's page, the
 *  three sizes, and full screen. A board adds its own after them. */
export function BoardControls({
  visible,
  settingsTitle,
  size,
  onSettings,
  onSize,
  isFullscreen,
  onToggleFullscreen,
  bottom = c(3.6),
  children,
}: {
  visible: boolean;
  /** What the board's page is for, as the Settings button's title. */
  settingsTitle: string;
  size: SizeKey | null;
  onSettings: () => void;
  onSize: (k: SizeKey) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Clear of whatever runs along the bottom of the board. */
  bottom?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="absolute flex items-center transition-opacity duration-300"
      style={{
        bottom,
        right: c(1.8),
        gap: c(0.3),
        padding: c(0.35),
        borderRadius: c(0.6),
        backgroundColor: 'var(--slate-raised)',
        opacity: visible ? 0.95 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Back to the board's page, where it was started from. The logo goes
          further, to the show's console; this is the one to press to change
          the board's own settings. */}
      <button type="button" onClick={onSettings} title={settingsTitle} className="rounded whitespace-nowrap" style={CONTROL_BUTTON}>
        ‹ Settings
      </button>
      <ControlRule />
      {SIZE_ORDER.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onSize(k)}
          title={`${PRESETS[k].label} · ${PRESETS[k].inches} · ${PRESETS[k].distance}`}
          className="rounded transition"
          style={{
            ...CONTROL_BUTTON,
            backgroundColor: k === size ? 'var(--accent-light)' : 'transparent',
            color: k === size ? 'var(--brand-slate)' : 'var(--on-slate-muted)',
          }}
        >
          {PRESETS[k].inches}
        </button>
      ))}
      <ControlRule />
      {/* Here rather than in the header, because it belongs with the other
          things you press once while standing at the screen and never again. */}
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Leave full screen (F)' : 'Fill the screen — hides the tab strip and address bar (F)'}
        className="rounded whitespace-nowrap"
        style={CONTROL_BUTTON}
      >
        {isFullscreen ? '⤡ Exit full screen' : '⤢ Full screen'}
      </button>
      {children}
    </div>
  );
}
