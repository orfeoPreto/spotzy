/**
 * API URL helpers — Session 26/27 live on separate CloudFormation stacks
 * (SpotManagerStack, BlockReservationsStack) because of CloudFormation's
 * 500-resource-per-stack limit. Each stack has its own API Gateway, so the
 * frontend needs to route calls to the right base URL.
 */

export const MAIN_API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
export const SPOT_MANAGER_API_URL =
  process.env.NEXT_PUBLIC_SPOT_MANAGER_API_URL ?? MAIN_API_URL;
export const BLOCK_API_URL =
  process.env.NEXT_PUBLIC_BLOCK_API_URL ?? MAIN_API_URL;

/** Spot Manager / v2.x listing pool / Session 28 quote + platform fee */
export const spotManagerApi = (pathname: string): string =>
  `${SPOT_MANAGER_API_URL}${pathname}`;

/** Block reservations + public magic-link claim */
export const blockApi = (pathname: string): string =>
  `${BLOCK_API_URL}${pathname}`;

/** Everything else — listings, bookings, chat, profile, auth, admin disputes... */
export const mainApi = (pathname: string): string =>
  `${MAIN_API_URL}${pathname}`;
