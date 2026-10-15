/* ── On a monitor ──────────────────────────────────────────────────────────
   Two ways a monitor plugged into a laptop or tablet can show a board:
   extended, where the board gets the monitor to itself in a window of its own
   (`openOnSecondScreen`, `?popout=1`) and this screen stays free; or
   duplicated, where the monitor mirrors this screen — the only thing a tablet
   mounted on the back of a TV can do — so the board runs in this tab and fills
   it (`?duplicate=1`). Either way it is only right full screen, and a browser
   goes full screen only on a press in that window, so a board that is not
   asks for one. */

export type FillPromptText = { button: string; note: string; keep: string };

/** What the *Fill the screen* prompt says, extended or duplicated. `noun` is
 *  the board as the office knows it — "the results board", "the gate board". */
export function fillPromptFor(noun: string): { extend: FillPromptText; duplicate: FillPromptText } {
  const named = noun.charAt(0).toUpperCase() + noun.slice(1);
  return {
    extend: {
      button: '⛶ Fill this screen',
      note: `${named}, on its own screen. The laptop or tablet it came from stays free.`,
      keep: 'Keep it in a window',
    },
    duplicate: {
      button: '⛶ Fill the screen',
      note: 'The monitor shows this screen, so the board fills both.',
      keep: 'Keep the browser showing',
    },
  };
}

// The Window Management API (Chrome and Edge on desktop), which is what lets a
// page find a monitor plugged into the laptop and put a window on it. Not in
// TypeScript's DOM library yet, so the few members used are declared here.
type ScreenDetailed = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label?: string;
};
type ScreenDetails = { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };

export type SecondScreenResult =
  | { kind: 'blocked' }
  | { kind: 'placed'; win: Window; screen: string | null }
  | { kind: 'window'; win: Window; reason: 'unsupported' | 'refused' | 'no-second-screen' };

/**
 * Open the running board in a window of its own, on the monitor attached to
 * this laptop or tablet where the browser can find one.
 *
 * `windowName` is per board, so opening a board a second time reuses its
 * window rather than stacking another one onto the TV — while the results
 * board and the gate board can each have a monitor of their own.
 *
 * The window opens **first**, while the press still counts as a user gesture —
 * asking for screen access can put up a permission prompt, and by the time it
 * is answered the gesture has expired and a popup would be blocked. It is then
 * moved onto the other screen and sized to fill it. A browser without the API,
 * a refused permission, or a display set to mirror all leave the window open
 * here to be dragged across.
 */
export async function openOnSecondScreen(url: string, windowName: string): Promise<SecondScreenResult> {
  const win = window.open(url, windowName, 'popup,width=1280,height=720');
  if (!win) return { kind: 'blocked' };

  const getScreenDetails = (window as Window & { getScreenDetails?: () => Promise<ScreenDetails> })
    .getScreenDetails;
  if (!getScreenDetails) return { kind: 'window', win, reason: 'unsupported' };

  let details: ScreenDetails;
  try {
    details = await getScreenDetails.call(window);
  } catch {
    return { kind: 'window', win, reason: 'refused' };
  }
  // Any screen but the one this page is on, largest first: with a TV and a
  // small second monitor both plugged in, the TV is the likelier target.
  const others = details.screens
    .filter((s) => s !== details.currentScreen)
    .sort((a, b) => b.availWidth * b.availHeight - a.availWidth * a.availHeight);
  const target = others[0];
  if (!target) return { kind: 'window', win, reason: 'no-second-screen' };

  try {
    win.moveTo(target.availLeft, target.availTop);
    win.resizeTo(target.availWidth, target.availHeight);
  } catch {
    return { kind: 'window', win, reason: 'refused' };
  }
  return { kind: 'placed', win, screen: target.label || null };
}
