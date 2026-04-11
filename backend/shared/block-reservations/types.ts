export type BlockRequestStatus =
  | 'PENDING_MATCH'
  | 'PLANS_PROPOSED'
  | 'CONFIRMED'
  | 'AUTHORISED'
  | 'SETTLED'
  | 'CANCELLED';

export type CancellationReason =
  | 'USER_CANCELLED_FREE'
  | 'USER_CANCELLED_50PCT'
  | 'AUTH_FAILED'
  | 'USER_ABANDONED'
  | 'SUPPORT_CANCELLED';

export type RiskShareMode = 'PERCENTAGE' | 'MIN_BAYS_FLOOR';

export interface BlockRequestPreferences {
  minPoolRating: number | null;
  requireVerifiedSpotManager: boolean | null;
  noIndividualSpots: boolean;
  maxCounterparties: number | null;
  maxWalkingTimeFromPoint: { minutes: number; lat: number; lng: number } | null;
  clusterTogether: boolean | null;
}

export interface PendingGuest {
  name: string;
  email: string;
  phone: string;
}

export interface BlockRequest {
  reqId: string;
  ownerUserId: string;
  status: BlockRequestStatus;
  cancellationReason: CancellationReason | null;
  startsAt: string;
  endsAt: string;
  bayCount: number;
  preferences: BlockRequestPreferences;
  pendingGuests: PendingGuest[] | null;
  companyNameSnapshot: string;
  vatNumberSnapshot: string;
  validationChargeId: string | null;
  authorisationId: string | null;
  authorisationRetryCount: number;
  proposedPlans: PlanSummary[] | null;
  proposedPlansComputedAt: string | null;
  acceptedPlanIndex: number | null;
  settlementBreakdown: SettlementBreakdown | null;
  auditLog: AuditLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanSummary {
  planIndex: number;
  rationale: string;
  worstCaseEur: number;
  bestCaseEur: number;
  projectedCaseEur: number;
  allocations: PlanAllocation[];
}

export interface PlanAllocation {
  poolListingId: string;
  spotManagerUserId: string;
  contributedBayCount: number;
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  pricePerBayEur: number;
  walkingDistanceMeters: number | null;
  poolRating: number;
}

export interface BlockAllocation {
  allocId: string;
  reqId: string;
  poolListingId: string;
  spotManagerUserId: string;
  contributedBayCount: number;
  allocatedBayCount: number;
  assignedBayIds: string[];
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  pricePerBayEur: number;
  settlement: AllocationSettlement | null;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationSettlement {
  amountEur: number;
  platformFeePct: number;
  platformFeeEur: number;
  netToSpotManagerEur: number;
  transferId: string | null;
  transferStatus: 'PENDING' | 'CREATED' | 'FAILED';
  settledAt: string;
}

export interface SettlementBreakdown {
  totalEur: number;
  capturedEur: number;
  refundedEur: number;
  perAllocation: Array<{
    allocId: string;
    contributedBayCount: number;
    allocatedBayCount: number;
    amountEur: number;
    platformFeeEur: number;
    transferId: string | null;
  }>;
}

export interface AuditLogEntry {
  timestamp: string;
  actorUserId: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface BlockBooking {
  bookingId: string;
  reqId: string;
  allocId: string;
  bayId: string;
  listingId: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  spotterId: string | null;
  emailStatus: 'PENDING' | 'SENT' | 'BOUNCED';
  emailSentAt: string | null;
  emailBouncedAt: string | null;
  allocationStatus: 'ALLOCATED' | 'CANCELLED';
  source: 'BLOCK_RESERVATION';
  createdAt: string;
  updatedAt: string;
}
