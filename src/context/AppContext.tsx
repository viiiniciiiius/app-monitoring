import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { TimeProps } from '../types';

interface AppContextProps {
  setHostName: (hostname: string) => Promise<void>;
  isHydrated: boolean;
  isMonitoringActive: boolean;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  time: TimeProps;
  setTime: React.Dispatch<React.SetStateAction<TimeProps>>;
  playSound: () => Promise<void>;
}

interface AppProviderProps {
  children: React.ReactNode;
}

const CACHE_KEY = '@field-monitoring:time';
const HOSTNAME_KEY = '@field-monitoring:info.hostname';
const MONITORING_ACTIVE_KEY = '@field-monitoring:monitoring.active';
const DEFAULT_CACHE_TIME = 15 * 24 * 60 * 60 * 1000;

export const AppContext =
  createContext<AppContextProps | undefined>(undefined);

function isTimeProps(value: unknown): value is TimeProps {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.type === 'h' || candidate.type === 'min') &&
    typeof candidate.value === 'number' &&
    Number.isFinite(candidate.value) &&
    candidate.value > 0
  );
}

export function AppProvider({ children }: AppProviderProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isMonitoringActive, setIsMonitoringActive] =
    useState(false);

  const [time, setTime] = useState<TimeProps>({
    type: 'h',
    value: 1,
  });

  const soundRef = useRef<Audio.Sound | null>(null);
  const isStartingSoundRef = useRef(false);

  useEffect(() => {
    let isActive = true;

    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/loud-beep.mp3'),
          {
            shouldPlay: false,
          },
        );

        if (!isActive) {
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
      } catch (error: unknown) {
        console.error('Erro ao carregar som:', error);
      }
    };

    void loadSound();

    return () => {
      isActive = false;

      const sound = soundRef.current;
      soundRef.current = null;
      isStartingSoundRef.current = false;

      if (sound) {
        void sound.unloadAsync().catch((error: unknown) => {
          console.error('Erro ao descarregar som:', error);
        });
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadStorageData = async () => {
      try {
        const [storedTime, storedMonitoringActive] =
          await AsyncStorage.multiGet([
            CACHE_KEY,
            MONITORING_ACTIVE_KEY,
          ]);

        if (!isActive) {
          return;
        }

        const storedTimeValue = storedTime[1];

        if (storedTimeValue) {
          try {
            const parsedTime: unknown = JSON.parse(storedTimeValue);

            if (isTimeProps(parsedTime)) {
              setTime(parsedTime);
            }
          } catch (error: unknown) {
            console.error('Erro ao carregar tempo:', error);
          }
        }

        setIsMonitoringActive(
          storedMonitoringActive[1] === 'true',
        );
      } catch (error: unknown) {
        console.error('Erro ao hidratar dados do app:', error);
      } finally {
        if (isActive) {
          setIsHydrated(true);
        }
      }
    };

    void loadStorageData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const saveTime = async () => {
      try {
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify(time),
        );
      } catch (error: unknown) {
        console.error('Erro ao salvar tempo:', error);
      }
    };

    void saveTime();
  }, [isHydrated, time]);

  const updateMonitoringState = useCallback(
    async (isActive: boolean): Promise<void> => {
      setIsMonitoringActive(isActive);

      try {
        await AsyncStorage.setItem(
          MONITORING_ACTIVE_KEY,
          JSON.stringify(isActive),
        );
      } catch (error: unknown) {
        setIsMonitoringActive(!isActive);
        console.error(
          'Erro ao salvar estado do monitoramento:',
          error,
        );
        throw error;
      }
    },
    [],
  );

  const startMonitoring = useCallback(async (): Promise<void> => {
    await updateMonitoringState(true);
  }, [updateMonitoringState]);

  const stopMonitoring = useCallback(async (): Promise<void> => {
    await updateMonitoringState(false);
  }, [updateMonitoringState]);

  const setHostName = useCallback(
    async (hostname: string): Promise<void> => {
      try {
        const cachePayload = {
          value: hostname,
          expiry: Date.now() + DEFAULT_CACHE_TIME,
        };

        await AsyncStorage.setItem(
          HOSTNAME_KEY,
          JSON.stringify(cachePayload),
        );
      } catch (error: unknown) {
        console.error('Erro ao salvar hostname:', error);
      }
    },
    [],
  );

  const playSound = useCallback(async (): Promise<void> => {
    const sound = soundRef.current;

    if (!sound || isStartingSoundRef.current) {
      return;
    }

    isStartingSoundRef.current = true;

    try {
      const status = await sound.getStatusAsync();

      if (!status.isLoaded || status.isPlaying) {
        return;
      }

      await sound.replayAsync();
    } catch (error: unknown) {
      console.error('Erro ao reproduzir som:', error);
    } finally {
      isStartingSoundRef.current = false;
    }
  }, []);

  const contextValue = useMemo<AppContextProps>(
    () => ({
      setHostName,
      isHydrated,
      isMonitoringActive,
      startMonitoring,
      stopMonitoring,
      time,
      setTime,
      playSound,
    }),
    [
      setHostName,
      isHydrated,
      isMonitoringActive,
      startMonitoring,
      stopMonitoring,
      time,
      playSound,
    ],
  );

  if (!isHydrated) {
    return null;
  }

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextProps {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error(
      'useAppContext must be used within AppProvider',
    );
  }

  return context;
}
