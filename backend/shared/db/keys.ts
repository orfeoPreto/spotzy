// DynamoDB single-table key builder functions for spotzy-main
// Each function returns the PK/SK pair (and optionally GSI1PK/GSI1SK)

// ---------------------------------------------------------------------------
// User / Profile
// PK: USER#{userId}  SK: PROFILE
// ---------------------------------------------------------------------------
export const userProfileKey = (userId: string) => ({
  PK: `USER#${userId}`,
  SK: 'PROFILE',
});

// ---------------------------------------------------------------------------
// Email → User lookup (GSI1)
// GSI1PK: EMAIL#{email}  GSI1SK: USER#{userId}
// ---------------------------------------------------------------------------
export const emailLookupKey = (email: string, userId: string) => ({
  PK: `USER#${userId}`,
  SK: 'PROFILE',
  GSI1PK: `EMAIL#${email}`,
  GSI1SK: `USER#${userId}`,
});

// ---------------------------------------------------------------------------
// Listing Metadata
// PK: LISTING#{listingId}  SK: METADATA
// GSI1PK: HOST#{hostId}   GSI1SK: LISTING#{listingId}
// ---------------------------------------------------------------------------
export const listingMetadataKey = (listingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: 'METADATA',
});

export const listingByHostKey = (hostId: string, listingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: 'METADATA',
  GSI1PK: `HOST#${hostId}`,
  GSI1SK: `LISTING#${listingId}`,
});

// GSI1 query key for listing-by-host queries
export const hostListingsGsi1Key = (hostId: string) => ({
  GSI1PK: `HOST#${hostId}`,
});

// ---------------------------------------------------------------------------
// Availability Rules
// PK: LISTING#{listingId}  SK: AVAIL_RULE#{ruleId}
// ---------------------------------------------------------------------------
export const availRuleKey = (listingId: string, ruleId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: `AVAIL_RULE#${ruleId}`,
});

export const availRulesForListing = (listingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK_prefix: 'AVAIL_RULE#',
});

// ---------------------------------------------------------------------------
// Availability Blocks (written by availability-block Lambda on booking confirm)
// PK: LISTING#{listingId}  SK: AVAIL_BLOCK#{date}#{bookingId}
// ---------------------------------------------------------------------------
export const availBlockKey = (listingId: string, date: string, bookingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: `AVAIL_BLOCK#${date}#${bookingId}`,
});

export const availBlocksForPeriod = (listingId: string, fromDate: string, toDate: string) => ({
  PK: `LISTING#${listingId}`,
  SK_between: [`AVAIL_BLOCK#${fromDate}`, `AVAIL_BLOCK#${toDate}~`],
});

// ---------------------------------------------------------------------------
// Booking Metadata
// PK: BOOKING#{bookingId}  SK: METADATA
// GSI1PK: SPOTTER#{userId} GSI1SK: BOOKING#{bookingId}
// ---------------------------------------------------------------------------
export const bookingMetadataKey = (bookingId: string) => ({
  PK: `BOOKING#${bookingId}`,
  SK: 'METADATA',
});

export const bookingBySpotterKey = (spotterId: string, bookingId: string) => ({
  PK: `BOOKING#${bookingId}`,
  SK: 'METADATA',
  GSI1PK: `SPOTTER#${spotterId}`,
  GSI1SK: `BOOKING#${bookingId}`,
});

// GSI1 query key for bookings-by-spotter queries
export const spotterBookingsGsi1Key = (spotterId: string) => ({
  GSI1PK: `SPOTTER#${spotterId}`,
});

// ---------------------------------------------------------------------------
// Listing → Booking relationship
// PK: LISTING#{listingId}  SK: BOOKING#{bookingId}
// ---------------------------------------------------------------------------
export const listingBookingKey = (listingId: string, bookingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: `BOOKING#${bookingId}`,
});

// ---------------------------------------------------------------------------
// Chat Messages
// PK: CHAT#{bookingId}  SK: MSG#{timestamp}#{messageId}
// ---------------------------------------------------------------------------
export const chatMessageKey = (
  bookingId: string,
  timestamp: string,
  messageId: string,
) => ({
  PK: `CHAT#${bookingId}`,
  SK: `MSG#${timestamp}#${messageId}`,
});

export const chatPartitionKey = (bookingId: string) => ({
  PK: `CHAT#${bookingId}`,
});

// ---------------------------------------------------------------------------
// Reviews
// PK: REVIEW#{targetId}  SK: REVIEW#{bookingId}
// ---------------------------------------------------------------------------
export const reviewKey = (targetId: string, bookingId: string) => ({
  PK: `REVIEW#${targetId}`,
  SK: `REVIEW#${bookingId}`,
});

// ---------------------------------------------------------------------------
// Dispute Metadata
// PK: DISPUTE#{disputeId}  SK: METADATA
// GSI1PK: BOOKING#{bookingId} GSI1SK: DISPUTE#{disputeId}
// ---------------------------------------------------------------------------
export const disputeMetadataKey = (disputeId: string) => ({
  PK: `DISPUTE#${disputeId}`,
  SK: 'METADATA',
});

export const disputeByBookingKey = (bookingId: string, disputeId: string) => ({
  PK: `DISPUTE#${disputeId}`,
  SK: 'METADATA',
  GSI1PK: `BOOKING#${bookingId}`,
  GSI1SK: `DISPUTE#${disputeId}`,
});

// GSI1 query key for disputes-by-booking queries
export const bookingDisputesGsi1Key = (bookingId: string) => ({
  GSI1PK: `BOOKING#${bookingId}`,
});

// ---------------------------------------------------------------------------
// Dispute Messages
// PK: DISPUTE#{disputeId}  SK: MSG#{timestamp}
// ---------------------------------------------------------------------------
export const disputeMessageKey = (disputeId: string, timestamp: string) => ({
  PK: `DISPUTE#${disputeId}`,
  SK: `MSG#${timestamp}`,
});

// ---------------------------------------------------------------------------
// User Preferences
// PK: USER#{userId}  SK: PREFS
// ---------------------------------------------------------------------------
export const userPrefsKey = (userId: string) => ({
  PK: `USER#${userId}`,
  SK: 'PREFS',
});

// ---------------------------------------------------------------------------
// Unread Message Counters
// PK: USER#{userId}  SK: UNREAD#{bookingId}
// ---------------------------------------------------------------------------
export const unreadKey = (userId: string, bookingId: string) => ({
  PK: `USER#${userId}`,
  SK: `UNREAD#${bookingId}`,
});

export const unreadPrefix = (userId: string) => ({
  PK: `USER#${userId}`,
  SK_prefix: 'UNREAD#',
});
