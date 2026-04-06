import { describe, it, expect } from 'vitest';
import { resolveDisplayName, resolveInitial } from '../../../lib/resolveDisplayName';

describe('resolveDisplayName', () => {
  it('returns pseudo when set', () => {
    expect(resolveDisplayName({ pseudo: 'SpotKing', firstName: 'Alice' })).toBe('SpotKing');
  });

  it('returns firstName when pseudo is null', () => {
    expect(resolveDisplayName({ pseudo: null, firstName: 'Alice' })).toBe('Alice');
  });

  it('returns firstName when pseudo is empty string', () => {
    expect(resolveDisplayName({ pseudo: '', firstName: 'Alice' })).toBe('Alice');
  });

  it('returns firstName when pseudo is whitespace only', () => {
    expect(resolveDisplayName({ pseudo: '   ', firstName: 'Bob' })).toBe('Bob');
  });
});

describe('resolveInitial', () => {
  it('returns first letter uppercase from pseudo', () => {
    expect(resolveInitial({ pseudo: 'spotKing', firstName: 'Alice' })).toBe('S');
  });

  it('returns first letter uppercase from firstName when pseudo is null', () => {
    expect(resolveInitial({ pseudo: null, firstName: 'alice' })).toBe('A');
  });
});
