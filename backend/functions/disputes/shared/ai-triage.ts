export type DisputeCategory = 'DAMAGE' | 'ACCESS_PROBLEM' | 'ESCALATION_REQUEST' | 'CONDITION_ISSUE' | 'SAFETY' | 'OTHER';

export interface TriageResult {
  category: DisputeCategory;
  requiresEscalation: boolean;
}

const PATTERNS: Array<{ pattern: RegExp; category: DisputeCategory; requiresEscalation: boolean }> = [
  { pattern: /scratch(ed)?|dent(ed)?|damage|broken|smashed/i, category: 'DAMAGE', requiresEscalation: true },
  { pattern: /speak to (a )?human|talk to (a )?person|real agent|escalate/i, category: 'ESCALATION_REQUEST', requiresEscalation: true },
  { pattern: /safety|dangerous|threat|assault/i, category: 'SAFETY', requiresEscalation: true },
  { pattern: /couldn.t access|can.t access|locked out|gate|barrier|no access/i, category: 'ACCESS_PROBLEM', requiresEscalation: false },
  { pattern: /dirty|mess|trash|rubbish|condition/i, category: 'CONDITION_ISSUE', requiresEscalation: false },
];

export const classifyDisputeMessage = (message: string): TriageResult => {
  for (const { pattern, category, requiresEscalation } of PATTERNS) {
    if (pattern.test(message)) return { category, requiresEscalation };
  }
  return { category: 'OTHER', requiresEscalation: false };
};
