/**
 * Team classes, and the riders on a team (migration 192).
 *
 * A class with a `team_size` is ridden by a team — Tandem Bareback and Rescue
 * Race two riders on one horse, 4-In-A-Line four riders each on their own. The
 * entry stays the team's: its exhibitor and horse are the rider who entered and
 * pays, and `team_members` are the rest. The rules are `backend/teams.py`'s;
 * this is how the screens read them.
 */

export interface TeamMember {
  exhibitor_id: string;
  exhibitor_name: string;
  /** Null: they ride the team's horse, the entry's own. */
  horse_id: string | null;
  horse_name: string | null;
  /** From 2: the rider who entered is 1. */
  position: number;
  /** The club they ride for on this team, where not their primary (migration 193). */
  club_id?: string | null;
}

/** What a team save sends: the whole team but the rider who entered, in order. */
export interface TeamSeat {
  exhibitor_id: string;
  horse_id: string | null;
  /** The club they ride for on this team; null for their primary. */
  club_id?: string | null;
}

/** The backend's `NAME_JOINER`, so a team reads the same on every screen. */
export const NAME_JOINER = ' / ';

/** The sizes the Class Builder offers. A class may store up to 12
 *  (`ck_classes_team_size`); these are the ones shows actually run. */
export const TEAM_SIZE_CHOICES = [2, 3, 4, 5, 6, 8] as const;

export function isTeamClass(size: number | null | undefined): size is number {
  return typeof size === 'number' && size >= 2;
}

/** The team as it is read out — "Bella Drevlow / Jennifer Peterson" — or the
 *  one rider's name on an ordinary entry. */
export function riderLabel(
  name: string,
  members: readonly Pick<TeamMember, 'exhibitor_name'>[] | null | undefined,
): string {
  return [name, ...(members ?? []).map((m) => m.exhibitor_name)].join(NAME_JOINER);
}

/** The horses a team rides: its own, then each one a teammate brought, once. */
export function horseLabel(
  horseName: string | null | undefined,
  members: readonly Pick<TeamMember, 'horse_id' | 'horse_name'>[] | null | undefined,
): string | null {
  const names: string[] = [];
  for (const candidate of [horseName, ...(members ?? []).filter((m) => m.horse_id).map((m) => m.horse_name)]) {
    if (candidate && !names.includes(candidate)) names.push(candidate);
  }
  return names.length ? names.join(NAME_JOINER) : null;
}

/** "1 rider still to name" — the flag a short team carries on the desk and
 *  the class page. A flag, never a refusal: the office may only learn the
 *  second rider's name on the morning. */
export function teamShortLabel(short: number): string {
  return `${short} rider${short === 1 ? '' : 's'} still to name`;
}

/** "Team of 2" — the Class Builder's and the pickers' word for a team class. */
export function teamSizeLabel(size: number): string {
  return `Team of ${size}`;
}
