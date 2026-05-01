// APHA-specific constants and utilities

export const APHA_DIVISIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SOLID_PAINT_BRED', label: 'Solid Paint-Bred' },
  { value: 'AMATEUR', label: 'Amateur' },
  { value: 'NOVICE_AMATEUR', label: 'Novice Amateur' },
  { value: 'YOUTH', label: 'Youth' },
  { value: 'NOVICE_YOUTH', label: 'Novice Youth' },
] as const;

export const RELATIONSHIP_OPTIONS = [
  'Self',
  'Spouse',
  'Parent',
  'Child',
  'Sibling',
  'Grandparent',
  'Grandchild',
] as const;

export const RELATIONSHIP_REQUIRED_DIVISIONS = new Set([
  'AMATEUR',
  'NOVICE_AMATEUR',
  'YOUTH',
  'NOVICE_YOUTH',
]);
