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
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  CameraMountError,
  CameraView,
  PermissionStatus,
} from 'expo-camera';
import { Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import {
  NavigationProp,
  useNavigation,
} from '@react-navigation/native';

import {
  COLORS,
  FONT_SIZES,
  FontStyleMedium,
  FontStyleRegular,
  SPACING,
} from '../theme';
import { CaptureResult, PhotoLog, RootStackList } from '../types';
import { useCameraContext } from '../context/CameraContext';
import { useAppContext } from '../context/AppContext';
import { diagnostics } from '../services/diagnostics';

const SOUND_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const CAMERA_READY_TIMEOUT_MS = 15 * 1000;
const CAMERA_STABILIZATION_MS = 1000;
const BUSY_RETRY_MS = 5000;
const FAILURE_RECHECK_MAX_MS = 15 * 60 * 1000;
const CAPTURE_RETRY_DELAYS_MS = [15_000, 30_000];
const MAX_CAPTURE_ATTEMPTS = CAPTURE_RETRY_DELAYS_MS.length + 1;
const MAX_LOGS = 50;

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface Counters {
  cycles: number;
  attempts: number;
  successes: number;
  failures: number;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });
}

function failureDescription(result: CaptureResult): string {
  if (result.ok) {
    return '';
  }

  const descriptions: Record<string, string> = {
    already_capturing: 'a câmera ainda estava ocupada',
    camera_permission_missing: 'permissão da câmera ausente',
    media_permission_missing: 'permissão da galeria ausente',
    camera_unavailable: 'câmera indisponível',
    storage_low: 'armazenamento crítico',
    empty_photo: 'a câmera não retornou uma imagem',
    stage_timeout: `tempo esgotado em ${result.stage}`,
    pipeline_error: `erro em ${result.stage}`,
  };

  return descriptions[result.reason] ?? result.reason;
}

function shouldRetry(result: CaptureResult): boolean {
  return (
    !result.ok &&
    result.reason !== 'storage_low' &&
    result.reason !== 'camera_permission_missing' &&
    result.reason !== 'media_permission_missing' &&
    !(
      result.reason === 'stage_timeout' &&
      result.stage === 'save_to_library'
    )
  );
}

function shouldRemountCamera(result: CaptureResult): boolean {
  return (
    !result.ok &&
    (result.stage === 'take_picture' ||
      result.reason === 'camera_unavailable')
  );
}

export default function MonitoringScreen() {
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
  const readyWaiterRef = useRef<ReadyWaiter | null>(null);
  const allowNavigationRef = useRef(false);
  const countersRef = useRef<Counters>({
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

  if (!permissionsReady) {
    const isLoadingPermissions =
      hasCameraPermission === null || hasMediaPermission === null;

    return (
      <View style={styles.container}>
        <Text style={styles.logText}>
          {isLoadingPermissions
            ? 'Verificando permissões...'
            : 'Permissões da câmera e da galeria são necessárias.'}
        </Text>

        {!isLoadingPermissions && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              void requestCameraPermission();
            }}
          >
            <Text style={styles.actionButtonText}>
              Solicitar permissões
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionButton, styles.stopButton]}
          onPress={confirmStopMonitoring}
        >
          <Text style={styles.actionButtonText}>Parar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isCameraMounted && (
        <View style={styles.cameraContainer}>
          <CameraView
            key={`camera-${cameraGeneration}`}
            ref={cameraRef}
            style={styles.camera}
            facing="back"
            onCameraReady={handleCameraReady}
            onMountError={handleCameraMountError}
          />
        </View>
      )}

      <Text style={[styles.textSecondary, FontStyleRegular]}>
        Posicione o celular para captura
      </Text>

      <Text style={[styles.title, FontStyleMedium]}>
        Monitoramento ativo
      </Text>

      <Text style={styles.statusText}>{statusMessage}</Text>

      <Text style={styles.detailText}>
        Última foto: {lastSuccessLabel ?? 'nenhuma nesta sessão'}
      </Text>

      {consecutiveFailures > 0 && (
        <Text style={styles.detailText}>
          Falhas consecutivas: {consecutiveFailures}
        </Text>
      )}

      {errorMessage && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}

      <FlatList
        data={logs}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => (
          <View style={styles.logItem}>
            <Text
              style={
                item.status === 'error'
                  ? styles.errorLogText
                  : styles.logText
              }
            >
              {item.message ?? 'Evento'} às {item.time}
            </Text>
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.actionButton, styles.stopButton]}
        onPress={confirmStopMonitoring}
      >
        <Text style={styles.actionButtonText}>
          Parar monitoramento
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    paddingTop: SPACING.xxxl * 2,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  cameraContainer: {
    width: 2,
    height: 2,
    overflow: 'hidden',
    opacity: 0.02,
  },
  camera: {
    flex: 1,
  },
  title: {
    color: COLORS.success,
    fontSize: FONT_SIZES.lx,
    marginBottom: SPACING.sm,
  },
  textSecondary: {
    fontSize: FONT_SIZES.lx,
    paddingTop: SPACING.xl,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  statusText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  detailText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  listContainer: {
    paddingBottom: SPACING.lg,
  },
  logItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
  },
  errorLogText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.md,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 99,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.md,
  },
  stopButton: {
    backgroundColor: COLORS.headerBackground,
  },
  actionButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    textAlign: 'center',
  },
});
