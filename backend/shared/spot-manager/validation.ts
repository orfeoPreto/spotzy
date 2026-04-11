import { RC_DOCUMENT_MAX_SIZE_MB, RC_DOCUMENT_ALLOWED_MIME_TYPES, POOL_MIN_BAY_COUNT, POOL_MAX_BAY_COUNT } from './constants';
import { BELGIAN_RC_INSURERS } from './insurers';

export function validateInsurer(insurer: string): boolean {
  return (BELGIAN_RC_INSURERS as readonly string[]).includes(insurer);
}

export function validatePolicyNumber(policyNumber: string): { valid: boolean; error?: string } {
  if (!policyNumber || policyNumber.length === 0) return { valid: false, error: 'POLICY_NUMBER_REQUIRED' };
  if (policyNumber.length > 100) return { valid: false, error: 'POLICY_NUMBER_TOO_LONG' };
  return { valid: true };
}

export function validateExpiryDate(expiryDate: string, now: Date): { valid: boolean; warning?: string; error?: string } {
  const expiry = new Date(expiryDate + 'T00:00:00Z');
  if (isNaN(expiry.getTime())) return { valid: false, error: 'INVALID_DATE_FORMAT' };
  if (expiry <= now) return { valid: false, error: 'EXPIRY_DATE_IN_PAST' };
  const daysFromNow = (expiry.getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysFromNow < 30) return { valid: true, warning: 'POLICY_NEAR_EXPIRY' };
  return { valid: true };
}

export function validateRCDocument(mimeType: string, sizeBytes: number): { valid: boolean; error?: string } {
  if (!RC_DOCUMENT_ALLOWED_MIME_TYPES.includes(mimeType)) return { valid: false, error: 'INVALID_MIME_TYPE' };
  if (sizeBytes > RC_DOCUMENT_MAX_SIZE_MB * 1024 * 1024) return { valid: false, error: 'FILE_TOO_LARGE' };
  if (sizeBytes <= 0) return { valid: false, error: 'EMPTY_FILE' };
  return { valid: true };
}

export function validateChecklistAcceptance(checklist: Record<string, unknown>): { valid: boolean; error?: string } {
  const required = ['reliableAccess', 'stableInstructions', 'chatResponseCommitment', 'suspensionAcknowledged'];
  for (const key of required) {
    if (checklist[key] !== true) return { valid: false, error: 'CHECKLIST_INCOMPLETE' };
  }
  return { valid: true };
}

export function validateBayCount(bayCount: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(bayCount)) return { valid: false, error: 'BAY_COUNT_NOT_INTEGER' };
  if (bayCount < POOL_MIN_BAY_COUNT) return { valid: false, error: 'BAY_COUNT_TOO_LOW' };
  if (bayCount > POOL_MAX_BAY_COUNT) return { valid: false, error: 'BAY_COUNT_TOO_HIGH' };
  return { valid: true };
}

export function generateBayLabel(bayIndex: number): string {
  return `Bay ${bayIndex + 1}`;
}
