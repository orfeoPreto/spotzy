export interface BookingCreatedEvent {
  'detail-type': 'booking.created';
  source: 'spotzy.booking-create';
  detail: {
    bookingId: string;
    listingId: string;
    spotterId: string;
    hostId: string;
    startTime: string;
    endTime: string;
    totalAmount: number;
  };
}

export interface BookingModifiedEvent {
  'detail-type': 'booking.modified';
  source: 'spotzy.booking-modify';
  detail: {
    bookingId: string;
    previousStartTime: string;
    previousEndTime: string;
    newStartTime: string;
    newEndTime: string;
    updatedBy: string;
  };
}

export interface BookingCancelledEvent {
  'detail-type': 'booking.cancelled';
  source: 'spotzy.booking-cancel';
  detail: {
    bookingId: string;
    cancelledBy: string;
    reason?: string;
  };
}

export interface BookingCompletedEvent {
  'detail-type': 'booking.completed';
  source: 'spotzy.scheduler';
  detail: {
    bookingId: string;
    listingId: string;
    spotterId: string;
    hostId: string;
  };
}

export interface DisputeCreatedEvent {
  'detail-type': 'dispute.created';
  source: 'spotzy.dispute-create';
  detail: {
    disputeId: string;
    bookingId: string;
    initiatorId: string;
    respondentId: string;
    reason: string;
  };
}

export interface DisputeEscalatedEvent {
  'detail-type': 'dispute.escalated';
  source: 'spotzy.dispute-escalate';
  detail: {
    disputeId: string;
    bookingId: string;
    escalatedBy: string;
  };
}

export interface ListingPublishedEvent {
  'detail-type': 'listing.published';
  source: 'spotzy.listing-publish';
  detail: {
    listingId: string;
    hostId: string;
    title: string;
  };
}

export type SpotzyEvent =
  | BookingCreatedEvent
  | BookingModifiedEvent
  | BookingCancelledEvent
  | BookingCompletedEvent
  | DisputeCreatedEvent
  | DisputeEscalatedEvent
  | ListingPublishedEvent;

export type SpotzyEventDetailType = SpotzyEvent['detail-type'];
