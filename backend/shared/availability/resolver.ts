import { AvailabilityRule, AvailabilityBlock, AvailabilityCheckResult } from '../types/availability';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns HH:mm minutes-from-midnight for a UTC Date */
function utcMinutes(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Returns a Date rounded up to the next whole UTC hour (or same if already on the hour) */
function ceilToHour(d: Date): Date {
  const ms = d.getTime();
  const remainder = ms % 3_600_000;
  if (remainder === 0) return new Date(ms);
  return new Date(ms - remainder + 3_600_000);
}

/** Parse "HH:mm" into minutes from midnight */
function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Returns true if the 1-hour slot starting at `slotStart` is covered by at least one rule.
 * slotStart must be on an exact UTC hour boundary.
 */
function slotCoveredByRules(rules: AvailabilityRule[], slotStart: Date): boolean {
  const day = slotStart.getUTCDay();           // 0=Sun…6=Sat
  const slotStartMin = utcMinutes(slotStart);
  const slotEndMin = slotStartMin + 60;

  for (const rule of rules) {
    if (rule.type === 'ALWAYS') return true;
    if (!rule.daysOfWeek.includes(day)) continue;
    const ruleStart = parseTime(rule.startTime);
    const ruleEnd = parseTime(rule.endTime);
    if (slotStartMin >= ruleStart && slotEndMin <= ruleEnd) return true;
  }
  return false;
}

/**
 * Returns true if the 1-hour slot starting at `slotStart` is blocked by any block record.
 */
function slotBlockedByBlocks(blocks: AvailabilityBlock[], slotStart: Date): boolean {
  const slotEnd = slotStart.getTime() + 3_600_000;
  for (const block of blocks) {
    const bStart = new Date(block.startTime).getTime();
    const bEnd = new Date(block.endTime).getTime();
    if (slotStart.getTime() < bEnd && slotEnd > bStart) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether a requested period is fully covered by at least one availability rule.
 * Decomposes the period into 1-hour chunks and checks every chunk.
 * Does NOT check for booking blocks.
 */
export function isWithinAvailabilityRules(
  rules: AvailabilityRule[],
  startTime: Date,
  endTime: Date,
): AvailabilityCheckResult {
  // Zero-length period is never covered
  if (endTime.getTime() <= startTime.getTime()) {
    return { covered: false, uncoveredPeriods: [{ from: startTime, to: endTime }] };
  }

  const uncoveredPeriods: Array<{ from: Date; to: Date }> = [];
  let cursor = ceilToHour(startTime);

  // If startTime is already on an exact hour boundary, start there
  if (startTime.getTime() === cursor.getTime()) {
    // already aligned
  }

  // Iterate hour-by-hour
  while (cursor.getTime() < endTime.getTime()) {
    if (!slotCoveredByRules(rules, cursor)) {
      const slotEnd = new Date(Math.min(cursor.getTime() + 3_600_000, endTime.getTime()));
      // Merge adjacent uncovered periods
      const last = uncoveredPeriods[uncoveredPeriods.length - 1];
      if (last && last.to.getTime() === cursor.getTime()) {
        last.to = slotEnd;
      } else {
        uncoveredPeriods.push({ from: new Date(cursor), to: slotEnd });
      }
    }
    cursor = new Date(cursor.getTime() + 3_600_000);
  }

  return { covered: uncoveredPeriods.length === 0, uncoveredPeriods };
}

/**
 * Returns the earliest available slot for a listing within a look-ahead window.
 * Iterates hour-by-hour from fromDate.
 */
export function findNextAvailableSlot(
  rules: AvailabilityRule[],
  blocks: AvailabilityBlock[],
  fromDate: Date,
  lookAheadDays: number,
): Date | null {
  const deadline = new Date(fromDate.getTime() + lookAheadDays * 86_400_000);
  let cursor = ceilToHour(fromDate);

  while (cursor.getTime() < deadline.getTime()) {
    if (slotCoveredByRules(rules, cursor) && !slotBlockedByBlocks(blocks, cursor)) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 3_600_000);
  }
  return null;
}

/**
 * Returns all free 1-hour slots within [fromDate, toDate] that are both rule-covered and unblocked.
 */
export function computeFreeSlots(
  rules: AvailabilityRule[],
  blocks: AvailabilityBlock[],
  fromDate: Date,
  toDate: Date,
  slotDurationHours: number,
): Array<{ start: Date; end: Date }> {
  const slotMs = slotDurationHours * 3_600_000;
  const slots: Array<{ start: Date; end: Date }> = [];
  let cursor = ceilToHour(fromDate);

  while (cursor.getTime() + slotMs <= toDate.getTime() + 1) {
    // Check all 1-hour chunks within the slot
    let allCovered = true;
    let anyBlocked = false;
    for (let h = 0; h < slotDurationHours; h++) {
      const hourStart = new Date(cursor.getTime() + h * 3_600_000);
      if (!slotCoveredByRules(rules, hourStart)) { allCovered = false; break; }
      if (slotBlockedByBlocks(blocks, hourStart)) { anyBlocked = true; break; }
    }
    if (allCovered && !anyBlocked) {
      slots.push({ start: new Date(cursor), end: new Date(cursor.getTime() + slotMs) });
    }
    cursor = new Date(cursor.getTime() + 3_600_000);
  }
  return slots;
}
