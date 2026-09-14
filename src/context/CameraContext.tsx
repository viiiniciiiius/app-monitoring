import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Camera,
  CameraView,
  PermissionStatus,
} from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import {
  CaptureErrorDetails,
  CaptureFailureReason,
  CaptureResult,
  CaptureStage,
} from '../types';
import { diagnostics } from '../services/diagnostics';

const TAKE_PICTURE_TIMEOUT_MS = 30_000;
const SAVE_TO_LIBRARY_TIMEOUT_MS = 30_000;
const LOW_STORAGE_BYTES = 256 * 1024 * 1024;
const DELAYED_CLEANUP_MS = 60_000;
const ORPHANED_CACHE_AGE_MS = 60 * 60 * 1000;

interface CameraContextProps {
  cameraRef: React.RefObject<CameraView | null>;
  hasCameraPermission: PermissionStatus | null;
  hasMediaPermission: boolean | null;
  requestCameraPermission: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  capturePhoto: (captureId: string) => Promise<CaptureResult>;
}

interface CameraProviderProps {
  children: React.ReactNode;
}

class CaptureStageTimeoutError extends Error {
  readonly code = 'CAPTURE_STAGE_TIMEOUT';

  constructor(
    readonly stage: CaptureStage,
    readonly timeoutMs: number,
  ) {
    super(`A etapa ${stage} excedeu ${timeoutMs} ms.`);
    this.name = 'CaptureStageTimeoutError';
  }
}

function errorDetails(error: unknown): CaptureErrorDetails {
  if (error instanceof Error) {
    const errorWithCode = error as Error & {
      code?: string | number;
    };

    return {
      name: error.name,
      message: error.message,
      code: errorWithCode.code,
      stack: error.stack,
    };
  }

  let message = 'Erro desconhecido';

  try {
    message =
      typeof error === 'string'
        ? error
        : JSON.stringify(error) || String(error);
  } catch {
    message = String(error);
  }

  return {
    name: 'UnknownError',
    message,
  };
}

async function withStageTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: CaptureStage,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new CaptureStageTimeoutError(stage, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function availableDiskSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

const CameraContext =
  createContext<CameraContextProps | undefined>(undefined);

export function CameraProvider({ children }: CameraProviderProps) {
  const cameraRef = useRef<CameraView | null>(null);
  const isCapturingRef = useRef(false);

  const [hasCameraPermission, setHasCameraPermission] =
    useState<PermissionStatus | null>(null);

  const [
    mediaPermission,
    requestMediaPermission,
    getMediaPermission,
  ] = MediaLibrary.usePermissions();

  const refreshPermissions = useCallback(async () => {
    try {
      const [cameraPermission, refreshedMediaPermission] =
        await Promise.all([
          Camera.getCameraPermissionsAsync(),
          getMediaPermission(),
        ]);

      setHasCameraPermission(cameraPermission.status);

      await diagnostics.info('permissions_refreshed', {
        camera: cameraPermission.status,
        media: refreshedMediaPermission.status,
      });
    } catch (error: unknown) {
      console.error('Erro ao atualizar permissões:', error);
      await diagnostics.error(
        'permissions_refresh_failed',
        error,
      );
    }
  }, [getMediaPermission]);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  useEffect(() => {
    const cleanupOrphanedCaptureFiles = async () => {
      let deletedFiles = 0;

      try {
        const cutoff = Date.now() - ORPHANED_CACHE_AGE_MS;

        for (const entry of Paths.cache.list()) {
          if (
            !(entry instanceof File) ||
            !entry.name.startsWith('monitoring_') ||
            entry.extension.toLowerCase() !== '.jpg'
          ) {
            continue;
          }

          const modifiedAt = entry.modificationTime;

          if (modifiedAt !== null && modifiedAt > cutoff) {
            continue;
          }

          entry.delete();
          deletedFiles += 1;
        }

        if (deletedFiles > 0) {
          await diagnostics.info('capture_orphaned_cache_cleaned', {
            deletedFiles,
          });
        }
      } catch (error: unknown) {
        console.error(
          'Erro ao limpar capturas temporárias antigas:',
          error,
        );
        await diagnostics.error(
          'capture_orphaned_cache_cleanup_failed',
          error,
          { deletedFiles },
        );
      }
    };

    void cleanupOrphanedCaptureFiles();
  }, []);

  const requestCameraPermission = useCallback(async () => {
    try {
      const cameraPermission =
        await Camera.requestCameraPermissionsAsync();

      setHasCameraPermission(cameraPermission.status);

      const refreshedMediaPermission = mediaPermission?.granted
        ? mediaPermission
        : await requestMediaPermission();

      await diagnostics.info('permissions_requested', {
        camera: cameraPermission.status,
        media: refreshedMediaPermission.status,
      });
    } catch (error: unknown) {
      console.error('Erro ao solicitar permissões:', error);
      await diagnostics.error(
        'permissions_request_failed',
        error,
      );
    }
  }, [mediaPermission, requestMediaPermission]);

  const cleanupTemporaryFile = useCallback(
    async (
      temporaryFile: File,
      captureId: string,
      delayed: boolean,
    ): Promise<void> => {
      const cleanup = async () => {
        try {
          if (temporaryFile.exists) {
            temporaryFile.delete();
          }
        } catch (error: unknown) {
          console.error(
            'Erro ao apagar arquivo temporário:',
            error,
          );
          await diagnostics.error(
            'capture_temp_cleanup_failed',
            error,
            { captureId, delayed },
          );
        }
      };

      if (delayed) {
        setTimeout(() => {
          void cleanup();
        }, DELAYED_CLEANUP_MS);
        return;
      }

      await cleanup();
    },
    [],
  );

  const capturePhoto = useCallback(
    async (captureId: string): Promise<CaptureResult> => {
      const startedAt = Date.now();
      let stage: CaptureStage = 'preflight';
      let temporaryFile: File | null = null;
      let shouldDelayCleanup = false;
      let fileName = '';
      let photoBytes: number | null = null;
      const initialAvailableDiskSpace = availableDiskSpace();

      const failure = (
        reason: CaptureFailureReason,
        error?: unknown,
      ): CaptureResult => ({
        ok: false,
        captureId,
        durationMs: Date.now() - startedAt,
        stage,
        reason,
        error: error === undefined ? undefined : errorDetails(error),
        availableDiskSpace: availableDiskSpace(),
      });

      if (isCapturingRef.current) {
        await diagnostics.warn('capture_rejected_busy', {
          captureId,
        });
        return failure('already_capturing');
      }

      if (hasCameraPermission !== PermissionStatus.GRANTED) {
        await diagnostics.warn('capture_permission_missing', {
          captureId,
          permission: 'camera',
          status: hasCameraPermission,
        });
        return failure('camera_permission_missing');
      }

      if (!mediaPermission?.granted) {
        await diagnostics.warn('capture_permission_missing', {
          captureId,
          permission: 'media_library',
          status: mediaPermission?.status ?? null,
        });
        return failure('media_permission_missing');
      }

      const currentCamera = cameraRef.current;

      if (!currentCamera) {
        await diagnostics.warn('capture_camera_unavailable', {
          captureId,
        });
        return failure('camera_unavailable');
      }

      if (
        initialAvailableDiskSpace !== null &&
        initialAvailableDiskSpace < LOW_STORAGE_BYTES
      ) {
        await diagnostics.error('storage_critical', undefined, {
          captureId,
          availableDiskSpace: initialAvailableDiskSpace,
          minimumRequiredBytes: LOW_STORAGE_BYTES,
        });
        return failure('storage_low');
      }

      isCapturingRef.current = true;

      await diagnostics.info('capture_started', {
        captureId,
        availableDiskSpace: initialAvailableDiskSpace,
      });

      try {
        stage = 'take_picture';
        const photo = await withStageTimeout(
          currentCamera.takePictureAsync({
            skipProcessing: true,
          }),
          TAKE_PICTURE_TIMEOUT_MS,
          stage,
        );

        if (!photo?.uri) {
          await diagnostics.error(
            'capture_empty_photo',
            undefined,
            { captureId, stage },
          );
          return failure('empty_photo');
        }

        fileName = `monitoring_${Date.now()}.jpg`;
        temporaryFile = new File(photo.uri);

        stage = 'move_to_cache';
        const renamedFile = new File(Paths.cache, fileName);
        temporaryFile.move(renamedFile);
        photoBytes = temporaryFile.size;

        stage = 'save_to_library';
        await withStageTimeout(
          MediaLibrary.createAssetAsync(temporaryFile.uri),
          SAVE_TO_LIBRARY_TIMEOUT_MS,
          stage,
        );

        stage = 'completed';

        const result: CaptureResult = {
          ok: true,
          captureId,
          durationMs: Date.now() - startedAt,
          stage,
          fileName,
          availableDiskSpace: availableDiskSpace(),
        };

        await diagnostics.info('capture_succeeded', {
          ...result,
          photoBytes,
        });

        void Haptics.impactAsync(
          Haptics.ImpactFeedbackStyle.Heavy,
        ).catch(async (error: unknown) => {
          console.warn('Não foi possível vibrar:', error);
          await diagnostics.warn('capture_haptics_failed', {
            captureId,
            error: errorDetails(error),
          });
        });

        return result;
      } catch (error: unknown) {
        const reason: CaptureFailureReason =
          error instanceof CaptureStageTimeoutError
            ? 'stage_timeout'
            : 'pipeline_error';

        shouldDelayCleanup =
          error instanceof CaptureStageTimeoutError &&
          stage === 'save_to_library';

        console.error(
          `Erro na etapa ${stage} da captura:`,
          error,
        );

        const result = failure(reason, error);

        await diagnostics.error('capture_failed', error, {
          ...result,
          timeoutMs:
            error instanceof CaptureStageTimeoutError
              ? error.timeoutMs
              : undefined,
          photoBytes,
        });

        return result;
      } finally {
        if (temporaryFile) {
          await cleanupTemporaryFile(
            temporaryFile,
            captureId,
            shouldDelayCleanup,
          );
        }

        isCapturingRef.current = false;
      }
    },
    [
      cleanupTemporaryFile,
      hasCameraPermission,
      mediaPermission?.granted,
      mediaPermission?.status,
    ],
  );

  const contextValue = useMemo<CameraContextProps>(
    () => ({
      cameraRef,
      hasCameraPermission,
      hasMediaPermission: mediaPermission?.granted ?? null,
      requestCameraPermission,
      refreshPermissions,
      capturePhoto,
    }),
    [
      hasCameraPermission,
      mediaPermission?.granted,
      requestCameraPermission,
      refreshPermissions,
      capturePhoto,
    ],
  );

  return (
    <CameraContext.Provider value={contextValue}>
      {children}
    </CameraContext.Provider>
  );
}

export function useCameraContext(): CameraContextProps {
  const context = useContext(CameraContext);

  if (!context) {
    throw new Error(
      'useCameraContext must be used within CameraProvider',
    );
  }

  return context;
}
