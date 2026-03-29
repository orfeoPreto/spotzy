export type DisputeStatus = 'open' | 'in_review' | 'resolved' | 'escalated';

export interface Dispute {
  disputeId: string;
  bookingId: string;
  initiatorId: string;
  respondentId: string;
  reason: string;
  status: DisputeStatus;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeMessage {
  disputeId: string;
  authorId: string;
  content: string;
  timestamp: string;
}
