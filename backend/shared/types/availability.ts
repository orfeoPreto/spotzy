export type AvailabilityRuleType = 'ALWAYS' | 'WEEKLY';

export interface AvailabilityRule {
  ruleId: string;
  listingId: string;
  type: AvailabilityRuleType;
  daysOfWeek: number[];   // 0=Sun … 6=Sat. Empty array when type=ALWAYS
  startTime: string;      // "HH:mm" 24h. Ignored when type=ALWAYS
  endTime: string;        // "HH:mm" 24h. Ignored when type=ALWAYS
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityBlock {
  listingId: string;
  bookingId: string;
  date: string;           // "YYYY-MM-DD"
  startTime: string;      // ISO8601 full datetime
  endTime: string;        // ISO8601 full datetime
  status: 'CONFIRMED' | 'ACTIVE' | 'PENDING_PAYMENT';
}

export interface AvailabilityCheckResult {
  covered: boolean;
  uncoveredPeriods: Array<{ from: Date; to: Date }>;
}
