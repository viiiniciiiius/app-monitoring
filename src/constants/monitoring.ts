export const SOUND_INTERVAL_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const CAMERA_READY_TIMEOUT_MS = 15 * 1000;
export const CAMERA_STABILIZATION_MS = 1000;
export const BUSY_RETRY_MS = 5000;
export const FAILURE_RECHECK_MAX_MS = 15 * 60 * 1000;
export const CAPTURE_RETRY_DELAYS_MS = [15_000, 30_000];
export const MAX_CAPTURE_ATTEMPTS =
  CAPTURE_RETRY_DELAYS_MS.length + 1;
export const MAX_LOGS = 50;
