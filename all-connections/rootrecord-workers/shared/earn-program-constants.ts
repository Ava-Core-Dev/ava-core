import { ROOTS_ATOMIC_PER_WHOLE } from "./roots-units";

/**
 * Earn program amounts are stored as atomic Roots integers.
 * 1 atomic = 0.00000001 whole Root; 100,000,000 atomic = 1 whole Root.
 */

/** 200 atomic per credited second (= 0.000002 whole Roots/s). */
export const UNITS_PER_SECOND = 200;

export const MAX_SECONDS_PER_PAGE = 15 * 60;

/** 100,000 atomic daily check-in (= 0.001 whole Roots). */
export const DAILY_CHECKIN_UNITS = 100_000;

/** 1,000,000 atomic per-app daily cap (= 0.01 whole Roots). */
export const DAILY_MAX_UNITS = 1_000_000;

export const MAX_GAP_SEC = 90;
export const MAX_CHUNK_SEC = 10;

/** 1,000,000 atomic one-time signup (= 0.01 whole Roots). */
export const SIGNUP_BONUS_UNITS = 1_000_000;

/** 5,000,000 atomic one-time per eligible app first open (= 0.05 whole Roots). */
export const FIRST_APP_OPEN_UNITS = 5_000_000;

/** 100,000 atomic to redeem one month Pro (= 0.001 whole Roots). */
export const PRO_REDEMPTION_UNIT_COST = 100_000;
export const PRO_REDEMPTION_DAYS = 30;

/** 1,000,000,000 atomic max per transfer (= 10 whole Roots). */
export const MAX_ROOT_UNITS_PER_TRANSFER = 1_000_000_000;

/** Included so clients can format atomic values as whole Roots. */
export const ROOTS_ATOMIC_PER_WHOLE_INT = ROOTS_ATOMIC_PER_WHOLE;
