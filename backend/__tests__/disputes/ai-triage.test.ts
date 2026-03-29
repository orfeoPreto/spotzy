import { classifyDisputeMessage } from '../../functions/disputes/shared/ai-triage';

describe('classifyDisputeMessage', () => {
  it('"my car was scratched" → DAMAGE, requiresEscalation: true', () => {
    expect(classifyDisputeMessage('my car was scratched')).toEqual({ category: 'DAMAGE', requiresEscalation: true });
  });

  it('"I couldn\'t access the spot" → ACCESS_PROBLEM, requiresEscalation: false', () => {
    expect(classifyDisputeMessage("I couldn't access the spot")).toEqual({ category: 'ACCESS_PROBLEM', requiresEscalation: false });
  });

  it('"I want to speak to a human" → ESCALATION_REQUEST, requiresEscalation: true', () => {
    expect(classifyDisputeMessage('I want to speak to a human')).toEqual({ category: 'ESCALATION_REQUEST', requiresEscalation: true });
  });

  it('"the spot was dirty" → CONDITION_ISSUE, requiresEscalation: false', () => {
    expect(classifyDisputeMessage('the spot was dirty')).toEqual({ category: 'CONDITION_ISSUE', requiresEscalation: false });
  });

  it('"there was a safety issue" → SAFETY, requiresEscalation: true', () => {
    expect(classifyDisputeMessage('there was a safety issue')).toEqual({ category: 'SAFETY', requiresEscalation: true });
  });

  it('"general complaint text" → OTHER, requiresEscalation: false', () => {
    expect(classifyDisputeMessage('general complaint text')).toEqual({ category: 'OTHER', requiresEscalation: false });
  });
});
