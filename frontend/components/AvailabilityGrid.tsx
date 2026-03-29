'use client';

import { useState, useEffect, useCallback } from 'react';

export type AvailabilityRuleType = 'ALWAYS' | 'WEEKLY';

export interface AvailabilityRule {
  ruleId?: string;
  listingId?: string;
  type: AvailabilityRuleType;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AvailabilityBlock {
  listingId: string;
  bookingId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'CONFIRMED' | 'ACTIVE' | 'PENDING_PAYMENT';
}

export interface SaveAvailabilityPayload {
  type: 'ALWAYS' | 'WEEKLY';
  rules: Array<{ daysOfWeek: number[]; startTime: string; endTime: string }>;
}

interface EditRule {
  id: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

interface AvailabilityGridProps {
  mode: 'edit' | 'display';
  rules?: AvailabilityRule[];
  blocks?: AvailabilityBlock[];
  onSave?: (payload: SaveAvailabilityPayload) => void;
  onDateSelect?: (date: Date) => void;
  selectedRange?: { start: Date; end: Date };
  saving?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseMinutes(hhmm: string): number {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function hasOverlap(rules: EditRule[]): string | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]; const b = rules[j];
      const shared = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
      if (shared.length === 0) continue;
      const aS = parseMinutes(a.startTime); const aE = parseMinutes(a.endTime);
      const bS = parseMinutes(b.startTime); const bE = parseMinutes(b.endTime);
      if (!isNaN(aS) && !isNaN(aE) && !isNaN(bS) && !isNaN(bE) && aS < bE && aE > bS) {
        return `Rules overlap on ${shared.map((d) => DAYS[d]).join(', ')}: ${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------
function EditMode({ initialRules, onSave, saving }: {
  initialRules?: AvailabilityRule[];
  onSave?: (payload: SaveAvailabilityPayload) => void;
  saving?: boolean;
}) {
  const [isAlways, setIsAlways] = useState(() =>
    initialRules ? initialRules.some((r) => r.type === 'ALWAYS') : false
  );
  const [editRules, setEditRules] = useState<EditRule[]>(() => {
    const weekly = (initialRules ?? []).filter((r) => r.type === 'WEEKLY');
    if (weekly.length > 0) {
      return weekly.map((r, i) => ({
        id: String(i),
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
      }));
    }
    return [{ id: '0', daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '20:00' }];
  });

  const overlapError = isAlways ? null : hasOverlap(editRules);

  const timeError = isAlways ? null : editRules.find((r) => {
    const s = parseMinutes(r.startTime); const e = parseMinutes(r.endTime);
    return !isNaN(s) && !isNaN(e) && e <= s;
  }) ? 'End time must be after start time for all rules' : null;

  const noRuleError = !isAlways && editRules.length === 0 ? 'Select at least one day.' : null;
  const noDayError = !isAlways && editRules.some((r) => r.daysOfWeek.length === 0) ? 'Each rule must have at least one day selected.' : null;

  const hasError = !!(overlapError || timeError || noRuleError || noDayError);

  const handleSave = () => {
    if (hasError || !onSave) return;
    if (isAlways) {
      onSave({ type: 'ALWAYS', rules: [] });
    } else {
      onSave({
        type: 'WEEKLY',
        rules: editRules.map((r) => ({ daysOfWeek: r.daysOfWeek, startTime: r.startTime, endTime: r.endTime })),
      });
    }
  };

  const toggleDay = (ruleId: string, day: number) => {
    setEditRules((prev) => prev.map((r) => {
      if (r.id !== ruleId) return r;
      const days = r.daysOfWeek.includes(day)
        ? r.daysOfWeek.filter((d) => d !== day)
        : [...r.daysOfWeek, day].sort((a, b) => a - b);
      return { ...r, daysOfWeek: days };
    }));
  };

  return (
    <div className="space-y-4">
      {/* Always available toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          aria-label="Always available"
          checked={isAlways}
          onChange={(e) => setIsAlways(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-amber-500"
        />
        <span className="text-sm font-medium text-gray-700">Always available (24/7)</span>
      </label>

      {/* Weekly grid */}
      {!isAlways && (
        <div data-testid="weekly-grid" className="space-y-3">
          {editRules.map((rule, idx) => (
            <div key={rule.id} className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">Rule {idx + 1}</span>
                {editRules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setEditRules((prev) => prev.filter((r) => r.id !== rule.id))}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Day toggles */}
              <div className="mb-3 flex flex-wrap gap-1">
                {DAYS.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    aria-label={DAY_LABELS[day]}
                    onClick={() => toggleDay(rule.id, day)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                      rule.daysOfWeek.includes(day)
                        ? 'bg-[#004526] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Time inputs */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="mb-0.5 block text-xs text-gray-500" htmlFor={`start-${rule.id}`}>
                    {`${DAY_LABELS[rule.daysOfWeek[0] ?? 0] ?? 'Day'} start time`}
                  </label>
                  <input
                    id={`start-${rule.id}`}
                    aria-label={`${DAY_LABELS[rule.daysOfWeek[0] ?? 0] ?? 'Day'} start time`}
                    type="time"
                    value={rule.startTime}
                    disabled={rule.daysOfWeek.length === 0}
                    onChange={(e) => setEditRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, startTime: e.target.value } : r))}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-40"
                  />
                </div>
                <span className="mt-4 text-gray-400">–</span>
                <div className="flex-1">
                  <label className="mb-0.5 block text-xs text-gray-500" htmlFor={`end-${rule.id}`}>
                    End time
                  </label>
                  <input
                    id={`end-${rule.id}`}
                    type="time"
                    value={rule.endTime}
                    disabled={rule.daysOfWeek.length === 0}
                    onChange={(e) => setEditRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, endTime: e.target.value } : r))}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-40"
                  />
                </div>
              </div>
            </div>
          ))}

          {editRules.length < 14 && (
            <button
              type="button"
              onClick={() => setEditRules((prev) => [...prev, {
                id: String(Date.now()), daysOfWeek: [], startTime: '08:00', endTime: '18:00',
              }])}
              className="text-sm text-[#004526] hover:underline"
            >
              + Add time slot
            </button>
          )}
        </div>
      )}

      {/* Validation errors */}
      {(overlapError || timeError || noRuleError || noDayError) && (
        <p className="text-sm text-red-600">
          {overlapError ?? timeError ?? noRuleError ?? noDayError}
        </p>
      )}

      <button
        type="button"
        aria-label="save"
        onClick={handleSave}
        disabled={hasError || saving}
        className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save availability'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display mode — 2-week rolling calendar
// ---------------------------------------------------------------------------
function parseRules(rules: AvailabilityRule[]) { return rules; }

function isSlotCovered(rules: AvailabilityRule[], slotStart: Date): boolean {
  const day = slotStart.getUTCDay();
  const slotStartMin = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
  const slotEndMin = slotStartMin + 60;
  for (const rule of rules) {
    if (rule.type === 'ALWAYS') return true;
    if (!rule.daysOfWeek.includes(day)) continue;
    const rS = parseMinutes(rule.startTime); const rE = parseMinutes(rule.endTime);
    if (slotStartMin >= rS && slotEndMin <= rE) return true;
  }
  return false;
}

function isSlotBlocked(blocks: AvailabilityBlock[], slotStart: Date): boolean {
  const slotEnd = slotStart.getTime() + 3_600_000;
  return blocks.some((b) => {
    const bS = new Date(b.startTime).getTime(); const bE = new Date(b.endTime).getTime();
    return slotStart.getTime() < bE && slotEnd > bS;
  });
}

function DisplayMode({ rules = [], blocks = [], onDateSelect, selectedRange }: {
  rules?: AvailabilityRule[];
  blocks?: AvailabilityBlock[];
  onDateSelect?: (date: Date) => void;
  selectedRange?: { start: Date; end: Date };
}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const days: Date[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  const isInSelectedRange = (d: Date) => {
    if (!selectedRange) return false;
    return d >= selectedRange.start && d < selectedRange.end;
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-400">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const covered = isSlotCovered(rules, day);
          const blocked = isSlotBlocked(blocks, day);
          const available = covered && !blocked;
          const inRange = isInSelectedRange(day);

          let bg = 'bg-gray-100 text-gray-400 cursor-not-allowed'; // not in rules
          if (covered && blocked) bg = 'bg-[#004526] text-white cursor-not-allowed'; // booked
          if (available) bg = inRange
            ? 'bg-[#006B3C] text-white cursor-pointer'
            : 'bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer';

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={!available}
              onClick={() => available && onDateSelect?.(day)}
              className={`rounded-lg p-1 text-center text-xs ${bg}`}
            >
              <div className="font-medium">{day.getUTCDate()}</div>
              <div className="text-[10px]">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][day.getUTCMonth()]}</div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 pt-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-green-100" /> Available</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#004526]" /> Booked</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-gray-100" /> Unavailable</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function AvailabilityGrid({
  mode, rules, blocks, onSave, onDateSelect, selectedRange, saving,
}: AvailabilityGridProps) {
  if (mode === 'edit') {
    return <EditMode initialRules={rules} onSave={onSave} saving={saving} />;
  }
  return <DisplayMode rules={rules} blocks={blocks} onDateSelect={onDateSelect} selectedRange={selectedRange} />;
}
