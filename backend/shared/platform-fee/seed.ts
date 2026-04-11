import { PLATFORM_FEE_DEFAULT_SINGLE_SHOT, PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION } from '../pricing/constants';
import type { PlatformFeeConfig } from '../pricing/types';

/**
 * Returns the default PlatformFeeConfig record used to seed the table on first deploy.
 * Idempotent -- calling this multiple times returns the same shape.
 */
export function defaultPlatformFeeConfig(): PlatformFeeConfig {
  return {
    singleShotPct: PLATFORM_FEE_DEFAULT_SINGLE_SHOT,
    blockReservationPct: PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION,
    lastModifiedBy: null,
    lastModifiedAt: null,
    historyLog: [],
  };
}
