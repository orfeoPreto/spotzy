const SPOT_TYPE_LABELS: Record<string, string> = {
  COVERED_GARAGE: 'Covered garage',
  CARPORT: 'Carport',
  DRIVEWAY: 'Driveway',
  OPEN_SPACE: 'Open space',
  OPEN_LOT: 'Open lot',
  STREET: 'Street',
  PRIVATE_DRIVEWAY: 'Private driveway',
};

export const spotTypeDisplay = (raw: string): string =>
  SPOT_TYPE_LABELS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase().replace(/_/g, ' ');
