import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import {
  CameraMountError,
  PermissionStatus,
} from 'expo-camera';
import { Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import {
  NavigationProp,
  useNavigation,
} from '@react-navigation/native';

import {
  MonitoringCounters,
  MonitoringReadyWaiter,
  PhotoLog,
  RootStackList,
} from '../types';
import { useCameraContext } from '../context/CameraContext';
import { useAppContext } from '../context/AppContext';
import { diagnostics } from '../services/diagnostics';
import {
  BUSY_RETRY_MS,
  CAMERA_READY_TIMEOUT_MS,
  CAMERA_STABILIZATION_MS,
  CAPTURE_RETRY_DELAYS_MS,
  FAILURE_RECHECK_MAX_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_CAPTURE_ATTEMPTS,
  MAX_LOGS,
  SOUND_INTERVAL_MS,
} from '../constants/monitoring';
import {
  failureDescription,
  shouldRemountCamera,
  shouldRetry,
  sleep,
} from '../utils/monitoring';

export function useMonitoringController() {
  useKeepAwake();

  const navigation =
    useNavigation<NavigationProp<RootStackList>>();

  const {
    cameraRef,
    hasCameraPermission,
    hasMediaPermission,
    requestCameraPermission,
    refreshPermissions,
    capturePhoto,
  } = useCameraContext();

  const { playSound, stopMonitoring, time } = useAppContext();

  const configuredMinutes =
    time.type === 'h' ? time.value * 60 : time.value;

  const photoIntervalMs =
    Math.max(1, configuredMinutes) * 60 * 1000;

  const [isCameraMounted, setIsCameraMounted] = useState(
    AppState.currentState === 'active',
  );
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const [logs, setLogs] = useState<PhotoLog[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    'Preparando câmera...',
  );
  const [lastSuccessLabel, setLastSuccessLabel] =
    useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] =
    useState(0);

  const monitoringRunIdRef = useRef(
    `run-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  );
  const isMountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(
    AppState.currentState,
  );
  const isCameraMountedRef = useRef(isCameraMounted);
  const cameraReadyRef = useRef(false);
  const lastCameraMountErrorRef = useRef<string | null>(null);
  const isCycleRunningRef = useRef(false);
  const runTokenRef = useRef(0);
  const cycleSequenceRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const lastSuccessAtRef = useRef<string | null>(null);
  const nextCaptureAtRef = useRef<number | null>(null);
  const photoTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyWaiterRef =
    useRef<MonitoringReadyWaiter | null>(null);
  const allowNavigationRef = useRef(false);
  const countersRef = useRef<MonitoringCounters>({
    cycles: 0,
    attempts: 0,
    successes: 0,
    failures: 0,
  });
  const playSoundRef = useRef(playSound);
  const runCaptureCycleRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const setCameraMounted = useCallback((mounted: boolean) => {
    isCameraMountedRef.current = mounted;
    setIsCameraMounted(mounted);
  }, []);

  const clearPhotoTimer = useCallback(() => {
    if (photoTimerRef.current) {
      clearTimeout(photoTimerRef.current);
      photoTimerRef.current = null;
    }
  }, []);

  const rejectReadyWaiter = useCallback((message: string) => {
    const waiter = readyWaiterRef.current;

    if (!waiter) {
      return;
    }

    readyWaiterRef.current = null;
    clearTimeout(waiter.timeout);
    waiter.reject(new Error(message));
  }, []);

  const scheduleNextPhoto = useCallback(
    (delayMs: number, reason: string) => {
      clearPhotoTimer();

      const safeDelayMs = Math.max(0, delayMs);
      const scheduledAt = Date.now();
      const targetAt = scheduledAt + safeDelayMs;
      nextCaptureAtRef.current = targetAt;

      void diagnostics.info('capture_scheduled', {
        monitoringRunId: monitoringRunIdRef.current,
        reason,
        intervalMs: photoIntervalMs,
        delayMs: safeDelayMs,
        targetAt: new Date(targetAt).toISOString(),
      });

      photoTimerRef.current = setTimeout(() => {
        photoTimerRef.current = null;

        void diagnostics.info('capture_timer_fired', {
          monitoringRunId: monitoringRunIdRef.current,
          targetAt: new Date(targetAt).toISOString(),
          driftMs: Date.now() - targetAt,
        });

        void runCaptureCycleRef.current();
      }, safeDelayMs);
    },
    [clearPhotoTimer, photoIntervalMs],
  );

  const ensureCameraReady = useCallback(
    async (cycleId: string, attempt: number): Promise<void> => {
      if (cameraReadyRef.current && cameraRef.current) {
        return;
      }

      if (lastCameraMountErrorRef.current) {
        throw new Error(lastCameraMountErrorRef.current);
      }

      if (!isCameraMountedRef.current) {
        lastCameraMountErrorRef.current = null;
        setCameraGeneration(previous => previous + 1);
        setCameraMounted(true);
      }

      await diagnostics.info('camera_ready_wait_started', {
        monitoringRunId: monitoringRunIdRef.current,
        cycleId,
        attempt,
        timeoutMs: CAMERA_READY_TIMEOUT_MS,
        cameraGeneration,
      });

      if (cameraReadyRef.current && cameraRef.current) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (readyWaiterRef.current?.timeout === timeout) {
            readyWaiterRef.current = null;
          }

          reject(
            new Error(
              `CameraView não ficou pronta em ${CAMERA_READY_TIMEOUT_MS} ms.`,
            ),
          );
        }, CAMERA_READY_TIMEOUT_MS);

        readyWaiterRef.current = {
          resolve,
          reject,
          timeout,
        };
      });
    },
    [cameraGeneration, cameraRef, setCameraMounted],
  );

  const recoverCamera = useCallback(
    async (
      cycleId: string,
      attempt: number,
      delayMs: number,
    ): Promise<void> => {
      cameraReadyRef.current = false;
      lastCameraMountErrorRef.current = null;
      rejectReadyWaiter('Sessão da câmera reiniciada.');
      setCameraMounted(false);

      await diagnostics.warn('camera_recovery_scheduled', {
        monitoringRunId: monitoringRunIdRef.current,
        cycleId,
        attempt,
        delayMs,
      });

      await sleep(delayMs);

      if (
        !isMountedRef.current ||
        appStateRef.current !== 'active'
      ) {
        return;
      }

      setCameraGeneration(previous => previous + 1);
      setCameraMounted(true);
    },
    [rejectReadyWaiter, setCameraMounted],
  );

  const addFailureLog = useCallback((message: string) => {
    const now = new Date();

    consecutiveFailuresRef.current += 1;
    setConsecutiveFailures(consecutiveFailuresRef.current);
    setErrorMessage(message);
    setLogs(previousLogs => {
      const newLog: PhotoLog = {
        id: `error-${now.getTime()}-${previousLogs.length}`,
        time: now.toLocaleString(),
        status: 'error',
        message,
      };

      return [newLog, ...previousLogs].slice(0, MAX_LOGS);
    });
  }, []);

  const runCaptureCycle = useCallback(async () => {
    if (!isMountedRef.current || appStateRef.current !== 'active') {
      return;
    }

    if (isCycleRunningRef.current) {
      await diagnostics.warn('capture_timer_while_busy', {
        monitoringRunId: monitoringRunIdRef.current,
      });
      scheduleNextPhoto(BUSY_RETRY_MS, 'cycle_busy');
      return;
    }

    isCycleRunningRef.current = true;
    const runToken = runTokenRef.current;
    const cycleId = `${monitoringRunIdRef.current}-c${++cycleSequenceRef.current}`;
    countersRef.current.cycles += 1;
    let succeeded = false;

    setStatusMessage('Capturando...');

    await diagnostics.info('capture_cycle_started', {
      monitoringRunId: monitoringRunIdRef.current,
      cycleId,
      configuredMinutes,
    });

    try {
      if (
        hasCameraPermission !== PermissionStatus.GRANTED ||
        hasMediaPermission !== true
      ) {
        countersRef.current.failures += 1;
        addFailureLog(
          'Captura pausada: permissões necessárias.',
        );
        await diagnostics.warn(
          'capture_cycle_permissions_missing',
          {
            monitoringRunId: monitoringRunIdRef.current,
            cycleId,
            cameraPermission: hasCameraPermission,
            mediaPermission: hasMediaPermission,
          },
        );
        return;
      }

      for (
        let attempt = 1;
        attempt <= MAX_CAPTURE_ATTEMPTS;
        attempt += 1
      ) {
        if (
          runToken !== runTokenRef.current ||
          appStateRef.current !== 'active'
        ) {
          await diagnostics.warn('capture_cycle_interrupted', {
            monitoringRunId: monitoringRunIdRef.current,
            cycleId,
            attempt,
            appState: appStateRef.current,
          });
          return;
        }

        countersRef.current.attempts += 1;
        const captureId = `${cycleId}-a${attempt}`;

        try {
          await ensureCameraReady(cycleId, attempt);
        } catch (error: unknown) {
          countersRef.current.failures += 1;
          const message = `Câmera não iniciou (tentativa ${attempt}/${MAX_CAPTURE_ATTEMPTS}).`;
          addFailureLog(message);

          await diagnostics.error('camera_ready_failed', error, {
            monitoringRunId: monitoringRunIdRef.current,
            cycleId,
            captureId,
            attempt,
            nativeMessage: lastCameraMountErrorRef.current,
          });

          if (attempt < MAX_CAPTURE_ATTEMPTS) {
            await recoverCamera(
              cycleId,
              attempt,
              CAPTURE_RETRY_DELAYS_MS[attempt - 1],
            );
            continue;
          }

          break;
        }

        await sleep(CAMERA_STABILIZATION_MS);

        if (
          runToken !== runTokenRef.current ||
          appStateRef.current !== 'active'
        ) {
          return;
        }

        const result = await capturePhoto(captureId);

        if (runToken !== runTokenRef.current) {
          await diagnostics.warn('capture_result_after_interrupt', {
            monitoringRunId: monitoringRunIdRef.current,
            ...result,
          });
          return;
        }

        if (result.ok) {
          const now = new Date();
          const successLabel = now.toLocaleString();

          countersRef.current.successes += 1;
          consecutiveFailuresRef.current = 0;
          lastSuccessAtRef.current = now.toISOString();
          succeeded = true;

          setConsecutiveFailures(0);
          setLastSuccessLabel(successLabel);
          setErrorMessage(null);
          setStatusMessage('Câmera pronta');
          setLogs(previousLogs => {
            const newLog: PhotoLog = {
              id: result.captureId,
              time: successLabel,
              status: 'success',
              message: 'Foto salva',
            };

            return [newLog, ...previousLogs].slice(0, MAX_LOGS);
          });
          break;
        }

        countersRef.current.failures += 1;
        const description = failureDescription(result);
        const message = `Falha na captura: ${description}.`;
        addFailureLog(message);

        await diagnostics.warn('capture_attempt_failed', {
          monitoringRunId: monitoringRunIdRef.current,
          cycleId,
          attempt,
          ...result,
        });

        if (!shouldRetry(result) || attempt >= MAX_CAPTURE_ATTEMPTS) {
          break;
        }

        const retryDelayMs = CAPTURE_RETRY_DELAYS_MS[attempt - 1];

        if (shouldRemountCamera(result)) {
          await recoverCamera(
            cycleId,
            attempt,
            retryDelayMs,
          );
        } else {
          await sleep(retryDelayMs);
        }
      }
    } finally {
      isCycleRunningRef.current = false;

      await diagnostics.info('capture_cycle_finished', {
        monitoringRunId: monitoringRunIdRef.current,
        cycleId,
        succeeded,
        consecutiveFailures: consecutiveFailuresRef.current,
        counters: countersRef.current,
      });

      if (
        runToken === runTokenRef.current &&
        isMountedRef.current &&
        appStateRef.current === 'active'
      ) {
        if (!succeeded) {
          setStatusMessage(
            'Falha registrada; aguardando o próximo ciclo',
          );
        }

        scheduleNextPhoto(
          succeeded
            ? photoIntervalMs
            : Math.min(photoIntervalMs, FAILURE_RECHECK_MAX_MS),
          succeeded ? 'cycle_succeeded' : 'cycle_failed_recheck',
        );
      }
    }
  }, [
    addFailureLog,
    capturePhoto,
    configuredMinutes,
    ensureCameraReady,
    hasCameraPermission,
    hasMediaPermission,
    photoIntervalMs,
    recoverCamera,
    scheduleNextPhoto,
  ]);

  runCaptureCycleRef.current = runCaptureCycle;

  const handleCameraReady = useCallback(() => {
    cameraReadyRef.current = true;
    lastCameraMountErrorRef.current = null;
    setStatusMessage('Câmera pronta');

    const waiter = readyWaiterRef.current;

    if (waiter) {
      readyWaiterRef.current = null;
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }

    void diagnostics.info('camera_ready', {
      monitoringRunId: monitoringRunIdRef.current,
      cameraGeneration,
    });
  }, [cameraGeneration]);

  const handleCameraMountError = useCallback(
    (event: CameraMountError) => {
      cameraReadyRef.current = false;
      lastCameraMountErrorRef.current =
        event.message || 'Falha nativa sem mensagem.';
      setErrorMessage('Não foi possível iniciar a câmera.');
      setStatusMessage('Erro ao iniciar câmera');
      rejectReadyWaiter(lastCameraMountErrorRef.current);

      void diagnostics.error(
        'camera_mount_failed',
        new Error(lastCameraMountErrorRef.current),
        {
          monitoringRunId: monitoringRunIdRef.current,
          cameraGeneration,
          nativeMessage: event.message,
        },
      );
    },
    [cameraGeneration, rejectReadyWaiter],
  );

  useEffect(() => {
    playSoundRef.current = playSound;
  }, [playSound]);

  useEffect(() => {
    isMountedRef.current = true;
    let effectActive = true;

    void (async () => {
      await diagnostics.markMonitoringActive({
        monitoringRunId: monitoringRunIdRef.current,
        configuredMinutes,
        intervalMs: photoIntervalMs,
      });

      const diagnosticStatus = await diagnostics.getStatus();

      if (diagnosticStatus.monitoringRunId) {
        monitoringRunIdRef.current =
          diagnosticStatus.monitoringRunId;
      }

      await diagnostics.info('monitoring_screen_started', {
        monitoringRunId: monitoringRunIdRef.current,
        configuredMinutes,
        intervalMs: photoIntervalMs,
      });

      if (effectActive && isMountedRef.current) {
        scheduleNextPhoto(0, 'monitoring_started');
      }
    })();

    return () => {
      effectActive = false;
      isMountedRef.current = false;
      runTokenRef.current += 1;
      clearPhotoTimer();
      rejectReadyWaiter('Tela de monitoramento encerrada.');

      void diagnostics.info('monitoring_screen_unmounted', {
        monitoringRunId: monitoringRunIdRef.current,
        counters: countersRef.current,
        lastSuccessAt: lastSuccessAtRef.current,
      });
    };
  }, [
    clearPhotoTimer,
    configuredMinutes,
    photoIntervalMs,
    rejectReadyWaiter,
    scheduleNextPhoto,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      nextAppState => {
        const previousAppState = appStateRef.current;
        appStateRef.current = nextAppState;

        void diagnostics.info('app_state_changed', {
          monitoringRunId: monitoringRunIdRef.current,
          previousAppState,
          nextAppState,
          cycleRunning: isCycleRunningRef.current,
        });

        if (nextAppState !== 'active') {
          runTokenRef.current += 1;
          clearPhotoTimer();
          rejectReadyWaiter(
            `Aplicativo mudou para ${nextAppState}.`,
          );
          cameraReadyRef.current = false;
          setCameraMounted(false);
          setStatusMessage('Monitoramento pausado pelo sistema');
          return;
        }

        lastCameraMountErrorRef.current = null;
        setCameraGeneration(previous => previous + 1);
        setCameraMounted(true);
        setStatusMessage('Retomando monitoramento...');
        void refreshPermissions();

        const remainingMs = Math.max(
          0,
          (nextCaptureAtRef.current ?? Date.now()) - Date.now(),
        );
        scheduleNextPhoto(remainingMs, 'app_became_active');
      },
    );

    return () => {
      subscription.remove();
    };
  }, [
    clearPhotoTimer,
    refreshPermissions,
    rejectReadyWaiter,
    scheduleNextPhoto,
    setCameraMounted,
  ]);

  useEffect(() => {
    const soundInterval = setInterval(() => {
      void playSoundRef.current().catch(async (error: unknown) => {
        console.error('Erro ao reproduzir som:', error);
        await diagnostics.error('monitoring_sound_failed', error, {
          monitoringRunId: monitoringRunIdRef.current,
        });
      });
    }, SOUND_INTERVAL_MS);

    return () => {
      clearInterval(soundInterval);
    };
  }, []);

  useEffect(() => {
    const heartbeatInterval = setInterval(() => {
      let availableDiskSpace: number | null = null;

      try {
        availableDiskSpace = Paths.availableDiskSpace;
      } catch {
        // A ausência desta métrica não deve interromper o heartbeat.
      }

      void diagnostics.heartbeat({
        monitoringRunId: monitoringRunIdRef.current,
        appState: appStateRef.current,
        intervalMs: photoIntervalMs,
        cameraMounted: isCameraMountedRef.current,
        cameraReady: cameraReadyRef.current,
        cycleRunning: isCycleRunningRef.current,
        nextCaptureAt: nextCaptureAtRef.current
          ? new Date(nextCaptureAtRef.current).toISOString()
          : null,
        lastSuccessAt: lastSuccessAtRef.current,
        consecutiveFailures: consecutiveFailuresRef.current,
        counters: countersRef.current,
        availableDiskSpace,
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [photoIntervalMs]);

  useEffect(() => {
    const unsubscribe = navigation.addListener(
      'beforeRemove',
      event => {
        if (allowNavigationRef.current) {
          return;
        }

        event.preventDefault();

        void (async () => {
          try {
            await stopMonitoring();
          } catch (error: unknown) {
            console.error(
              'Erro ao salvar parada do monitoramento:',
              error,
            );
            await diagnostics.error(
              'monitoring_stop_persist_failed',
              error,
              { monitoringRunId: monitoringRunIdRef.current },
            );
          } finally {
            await diagnostics.markMonitoringStopped({
              reason: 'user_navigation',
              monitoringRunId: monitoringRunIdRef.current,
              counters: countersRef.current,
              lastSuccessAt: lastSuccessAtRef.current,
            });
            allowNavigationRef.current = true;
            navigation.dispatch(event.data.action);
          }
        })();
      },
    );

    return unsubscribe;
  }, [navigation, stopMonitoring]);

  const confirmStopMonitoring = useCallback(() => {
    Alert.alert(
      'Parar monitoramento?',
      'As capturas automáticas serão interrompidas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Parar',
          style: 'destructive',
          onPress: () => {
            navigation.reset({
              index: 0,
              routes: [{ name: 'Menu' }],
            });
          },
        },
      ],
    );
  }, [navigation]);

  const permissionsReady =
    hasCameraPermission === PermissionStatus.GRANTED &&
    hasMediaPermission === true;

  const isLoadingPermissions =
    hasCameraPermission === null || hasMediaPermission === null;

  return {
    cameraGeneration,
    cameraRef,
    confirmStopMonitoring,
    consecutiveFailures,
    errorMessage,
    handleCameraMountError,
    handleCameraReady,
    isCameraMounted,
    isLoadingPermissions,
    lastSuccessLabel,
    logs,
    permissionsReady,
    requestCameraPermission,
    statusMessage,
  };
}

export type MonitoringController = ReturnType<
  typeof useMonitoringController
>;
