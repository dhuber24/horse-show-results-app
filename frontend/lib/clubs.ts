/**
 * Saddle clubs and saddle-club high point (migration 193). The rules are
 * `backend/club_points.py`'s; these are the shapes the screens read.
 */

export type TeamRule = 'each_rider' | 'entrant' | 'none';

export interface ClubOption {
  id: string;
  name: string;
}

/** The show office's setup: whether the show keeps club standings, which
 *  clubs compete, how many one rider may ride for, and how team classes count. */
export interface ClubPointsSetup {
  enabled: boolean;
  clubs_per_rider: number;
  team_rule: TeamRule;
  clubs: ClubOption[];
}

/** A rider's clubs at a show: the competing clubs they hold a membership with,
 *  and the one(s) they ride for. `derived`: nobody chose; they hold one. */
export interface RiderClubs {
  held: ClubOption[];
  club_ids: string[];
  primary_id: string | null;
  derived: boolean;
}

export const TEAM_RULE_LABELS: Record<TeamRule, string> = {
  each_rider: "Each rider's own club",
  entrant: 'The club of the rider who entered',
  none: "Team classes don't count for clubs",
};

export interface ClubStanding {
  rank: number;
  club_id: string;
  club_name: string;
  points: number;
  class_count: number;
  show_count: number;
}

export interface ClubStandings {
  name: string;
  standings: ClubStanding[];
}
