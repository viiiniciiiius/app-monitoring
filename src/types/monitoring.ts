
export interface PhotoLog {
  id: string;
  time: string;
  status?: 'success' | 'error';
  message?: string;
  uri?: string;
}

export interface MonitoringReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface MonitoringCounters {
  cycles: number;
  attempts: number;
  successes: number;
  failures: number;
}

export type CaptureStage =
  | 'preflight'
  | 'take_picture'
  | 'move_to_cache'
  | 'save_to_library'
  | 'completed';

export type CaptureFailureReason =
  | 'already_capturing'
  | 'camera_permission_missing'
  | 'media_permission_missing'
  | 'camera_unavailable'
  | 'storage_low'
  | 'empty_photo'
  | 'stage_timeout'
  | 'pipeline_error';

export interface CaptureErrorDetails {
  name: string;
  message: string;
  code?: string | number;
  stack?: string;
}

interface CaptureResultBase {
  captureId: string;
  durationMs: number;
  stage: CaptureStage;
  availableDiskSpace: number | null;
}

export type CaptureResult =
  | (CaptureResultBase & {
      ok: true;
      fileName: string;
    })
  | (CaptureResultBase & {
      ok: false;
      reason: CaptureFailureReason;
      error?: CaptureErrorDetails;
    });
