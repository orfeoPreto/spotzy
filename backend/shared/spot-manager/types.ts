import type { BelgianRCInsurer } from './insurers';

export type SpotManagerStatus = 'NONE' | 'STAGED' | 'ACTIVE';

export type RCInsuranceStatus =
  | 'NONE'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'EXPIRED'
  | 'REJECTED';

export type RCSubmissionStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUESTED'
  | 'SUPERSEDED';

export type RCRejectionReason =
  | 'EXPIRED_POLICY'
  | 'ILLEGIBLE_DOCUMENT'
  | 'WRONG_INSURANCE_TYPE'
  | 'NAME_MISMATCH'
  | 'OTHER';

export interface ChecklistAcceptance {
  reliableAccess: boolean;
  stableInstructions: boolean;
  chatResponseCommitment: boolean;
  suspensionAcknowledged: boolean;
  acceptedAt: string;
}

export interface RCSubmission {
  submissionId: string;
  userId: string;
  insurer: BelgianRCInsurer;
  policyNumber: string;
  expiryDate: string;
  documentS3Key: string;
  documentMimeType: string;
  documentSizeBytes: number;
  checklistAcceptance: ChecklistAcceptance;
  tcsVersionAccepted: string;
  status: RCSubmissionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  rejectionReason: RCRejectionReason | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpotManagerProfileFields {
  spotManagerStatus: SpotManagerStatus;
  blockReservationCapable: boolean;
  rcInsuranceStatus: RCInsuranceStatus;
  rcInsuranceExpiryDate: string | null;
  rcInsuranceApprovedAt: string | null;
  currentRCSubmissionId: string | null;
}

export type BayStatus = 'ACTIVE' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_REMOVED';

export interface PoolSpot {
  bayId: string;
  poolListingId: string;
  label: string;
  accessInstructions: string | null;
  status: BayStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SpotPoolListingExtension {
  isPool: true;
  bayCount: number;
  blockReservationsOptedIn: boolean;
  riskShareMode: 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | null;
}

export interface RCReminderLog {
  submissionId: string;
  type: '30_DAY_REMINDER' | '7_DAY_REMINDER';
  sentAt: string | null;
  channel: 'EMAIL' | 'IN_APP' | 'BOTH';
  skipReason: 'SUPERSEDED' | 'RENEWED_EARLY' | null;
}

export interface RCSuspendLog {
  submissionId: string;
  suspendedAt: string;
  reason: 'EXPIRED';
  affectedListingIds: string[];
}

export interface SoftLock {
  submissionId: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
}
