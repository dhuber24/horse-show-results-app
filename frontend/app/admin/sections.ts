/**
 * The admin hub's tiles, per role — and the office half of the staff sidebar,
 * which lists the same thing on every page. One list, so a screen added to the
 * hub is in the sidebar too.
 */
export type AdminSection = {
  href: string;
  title: string;
  description: string;
  icon: string;
};

export const MY_COMPANY_TILE: AdminSection = {
  href: '/admin/my-company',
  title: 'My Company Staff',
  description: 'The managers and secretaries in your company — ask for colleagues to be added, answer requests to join, remove anybody who has left.',
  icon: 'S',
};

// A show company keeps its own points systems (migration 148), so every
// manager and secretary -- all of them are in a company -- gets the tile.
const POINT_SYSTEMS_TILE: AdminSection = {
  href: '/admin/point-systems',
  title: 'Points Systems',
  description: "Your company's high-point charts — how a posted placing becomes points at your shows.",
  icon: 'P',
};

const adminTiles: AdminSection[] = [
  { href: '/admin/shows', title: 'Shows', description: 'Create, edit, and manage horse shows, classes, and entries.', icon: 'T' },
  { href: '/admin/venues', title: 'Venues', description: 'Add and update venues where shows are held.', icon: 'V' },
  { href: '/admin/horses', title: 'Horse Registry', description: 'Add and edit horses in the system.', icon: 'H' },
  { href: '/admin/trainers', title: 'Trainer Registry', description: 'Manage trainer registry records used on horse profiles.', icon: 'R' },
  { href: '/admin/judges', title: 'Judge Registry', description: 'One record per judge, shared by every show they work.', icon: 'J' },
  { href: '/admin/users', title: 'Users', description: 'Create users, assign roles, and manage Show Secretaries and Scribes.', icon: 'U' },
  { href: '/admin/companies', title: 'Show Companies', description: 'The clubs and firms that run shows, and the paid features turned on for them.', icon: 'S' },
  { href: '/admin/exhibitors', title: 'Exhibitor Records', description: 'Everyone who competes, including walk-ups the office typed in and who have no login.', icon: 'E' },
  { href: '/admin/standard-classes', title: 'Class Codes', description: "Load an association's approved class list from their published file.", icon: 'C' },
  { href: '/admin/point-systems', title: 'Points Systems', description: "Every show company's high-point charts — how a posted placing becomes points.", icon: 'P' },
  { href: '/admin/circuits', title: 'Season Circuits', description: 'Several shows added together for a season high point.', icon: 'O' },
];

const showSecretaryTiles: AdminSection[] = [
  { href: '/admin/shows', title: 'My Shows', description: 'Create and manage the shows you own.', icon: 'T' },
  { href: '/admin/circuits', title: 'Season Circuits', description: 'Add your shows together for a season high point.', icon: 'O' },
  POINT_SYSTEMS_TILE,
  MY_COMPANY_TILE,
];

const showManagerTiles: AdminSection[] = [
  { href: '/admin/shows', title: 'My Shows', description: 'Create and manage the shows you run.', icon: 'T' },
  { href: '/admin/venues', title: 'Venues', description: 'Add and update venues where your shows are held.', icon: 'V' },
  { href: '/admin/circuits', title: 'Season Circuits', description: 'Add your shows together for a season high point.', icon: 'O' },
  POINT_SYSTEMS_TILE,
  MY_COMPANY_TILE,
];

export function adminSections(role: string | null | undefined): AdminSection[] {
  return role === 'SHOW_SECRETARY' ? showSecretaryTiles :
    role === 'SHOW_MANAGER' ? showManagerTiles :
    adminTiles;
}

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_SECRETARY: 'Show Secretary',
  SHOW_MANAGER: 'Show Manager',
};
