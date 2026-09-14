import { Platform } from 'react-native';

import { diagnostics } from './diagnostics';

interface NativeErrorUtils {
  getGlobalHandler?: () => (
    error: unknown,
    isFatal?: boolean,
  ) => void;
  setGlobalHandler?: (
    handler: (error: unknown, isFatal?: boolean) => void,
  ) => void;
}

interface DiagnosticsGlobal extends Record<string, unknown> {
  ErrorUtils?: NativeErrorUtils;
  __FIELD_MONITORING_DIAGNOSTICS_INSTALLED__?: boolean;
}

function isLoggerFallback(argumentsList: unknown[]): boolean {
  return (
    typeof argumentsList[0] === 'string' &&
    argumentsList[0].startsWith('[diagnostics:')
  );
}

function firstError(argumentsList: unknown[]): Error | undefined {
  return argumentsList.find(
    argument => argument instanceof Error,
  ) as Error | undefined;
}

export function installRuntimeDiagnostics(
  appVersion: string,
): void {
  const diagnosticsGlobal =
    globalThis as unknown as DiagnosticsGlobal;

  if (diagnosticsGlobal.__FIELD_MONITORING_DIAGNOSTICS_INSTALLED__) {
    return;
  }

  diagnosticsGlobal.__FIELD_MONITORING_DIAGNOSTICS_INSTALLED__ = true;

  const platformConstants = Platform.constants as unknown as Record<
    string,
    unknown
  >;

  void diagnostics.initialize({
    appVersion,
    environment: process.env.NODE_ENV,
    platform: Platform.OS,
    osVersion: Platform.Version,
    manufacturer: platformConstants.Manufacturer,
    model: platformConstants.Model,
    reactNativeVersion: platformConstants.reactNativeVersion,
  });

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  console.error = (...argumentsList: unknown[]) => {
    originalConsoleError(...argumentsList);

    if (isLoggerFallback(argumentsList)) {
      return;
    }

    void diagnostics.error(
      'console_error',
      firstError(argumentsList),
      { arguments: argumentsList },
    );
  };

  console.warn = (...argumentsList: unknown[]) => {
    originalConsoleWarn(...argumentsList);

    if (isLoggerFallback(argumentsList)) {
      return;
    }

    void diagnostics.warn('console_warning', {
      arguments: argumentsList,
    });
  };

  const errorUtils = diagnosticsGlobal.ErrorUtils;
  const previousGlobalHandler = errorUtils?.getGlobalHandler?.();

  if (errorUtils?.setGlobalHandler && previousGlobalHandler) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      void diagnostics.error('unhandled_js_error', error, {
        isFatal: Boolean(isFatal),
      });

      previousGlobalHandler(error, isFatal);
    });
  }
}
