export const BELGIAN_RC_INSURERS = [
  'AG Insurance',
  'Allianz Belgium',
  'Argenta Assuranties',
  'AXA Belgium',
  'Baloise Insurance',
  'Belfius Insurance',
  'DKV Belgium',
  'Ethias',
  'Federale Verzekering',
  'KBC Verzekeringen',
  'P&V Verzekeringen',
  'Vivium',
  'Other (please specify in policy number field)',
] as const;

export type BelgianRCInsurer = typeof BELGIAN_RC_INSURERS[number];
