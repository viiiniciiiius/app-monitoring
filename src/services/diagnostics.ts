import { Directory, File, Paths } from 'expo-file-system';

export type DiagnosticsLevel = 'info' | 'warn' | 'error';

export type DiagnosticDetails = Readonly<Record<string, unknown>>;

export type DiagnosticJsonValue =
  | string
  | number
  | boolean
  | null
  | DiagnosticJsonValue[]
  | { [key: string]: DiagnosticJsonValue };

export interface NormalizedDiagnosticError {
  name: string;
  message: string;
  code?: string | number;
  stack?: string;
  cause?: NormalizedDiagnosticError;
}

export interface DiagnosticRecord {
  schemaVersion: 1;
  tsUtc: string;
  timezoneOffsetMinutes: number;
  monotonicMs: number;
  sequence: number;
  sessionId: string;
  monitoringRunId?: string;
  level: DiagnosticsLevel;
  event: string;
  details?: { [key: string]: DiagnosticJsonValue };
  error?: NormalizedDiagnosticError;
}

export interface DiagnosticsFileStatus {
  name: string;
  date: string;
  segment: number;
  sizeBytes: number;
  modifiedAtUtc: string | null;
}

export interface DiagnosticsInternalErrorStatus {
  atUtc: string;
  operation: string;
  error: NormalizedDiagnosticError;
}

export interface DiagnosticsStatus {
  initialized: boolean;
  sessionId: string;
  sessionStartedAtUtc: string;
  sessionEnded: boolean;
  monitoringActive: boolean;
  monitoringRunId: string | null;
  monitoringStartedAtUtc: string | null;
  lastHeartbeatAtUtc: string | null;
  directoryUri: string;
  retentionDateCount: number;
  maxSegmentBytes: number;
  pendingOperations: number;
  currentFileName: string | null;
  lastWriteAtUtc: string | null;
  fileCount: number;
  retainedDates: string[];
  totalBytes: number;
  availableDiskBytes: number | null;
  totalDiskBytes: number | null;
  files: DiagnosticsFileStatus[];
  lastInternalError: DiagnosticsInternalErrorStatus | null;
}

export interface DiagnosticsExportResult {
  exportedAtUtc: string;
  directoryUri: string;
  fileNames: string[];
  fileCount: number;
  totalBytes: number;
}

interface ActiveMonitoringMarker {
  schemaVersion: 1;
  active: true;
  sessionId: string;
  monitoringRunId: string;
  startedAtUtc: string;
  lastHeartbeatAtUtc: string | null;
}

interface ParsedLogFile {
  file: File;
  name: string;
  date: string;
  segment: number;
  sizeBytes: number;
}

interface PreparedEvent {
  event: string;
  details?: { [key: string]: DiagnosticJsonValue };
  error?: NormalizedDiagnosticError;
  occurredAt: Date;
  monotonicMs: number;
}

const DIAGNOSTICS_DIRECTORY_NAME = 'diagnostics';
const ACTIVE_MONITORING_FILE_NAME = 'active-monitoring.json';
const LOG_FILE_PATTERN =
  /^diagnostics-(\d{4}-\d{2}-\d{2})-(\d{3})\.jsonl$/;
const RETENTION_DATE_COUNT = 8;
const MAX_SEGMENT_BYTES = 10 * 1024 * 1024;
const MAX_EVENT_LENGTH = 160;
const MAX_STRING_LENGTH = 16 * 1024;
const MAX_STACK_LENGTH = 32 * 1024;
const MAX_OBJECT_DEPTH = 7;
const MAX_COLLECTION_ITEMS = 100;
const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';

const diagnosticsDirectory = new Directory(
  Paths.document,
  DIAGNOSTICS_DIRECTORY_NAME,
);

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }

  return `${value.slice(0, maximumLength)}...${TRUNCATED_VALUE}`;
}

function safeProperty(object: object, key: string): unknown {
  try {
    return (object as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function errorText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim()
    ? truncate(value, MAX_STRING_LENGTH)
    : fallback;
}

export function normalizeDiagnosticError(
  error: unknown,
  depth = 0,
): NormalizedDiagnosticError {
  if (depth >= 4) {
    return {
      name: 'ErrorCauseDepthExceeded',
      message: TRUNCATED_VALUE,
    };
  }

  if (error instanceof Error) {
    const code = safeProperty(error, 'code');
    const cause = safeProperty(error, 'cause');

    return {
      name: errorText(error.name, 'Error'),
      message: errorText(error.message, 'Erro sem mensagem.'),
      ...(typeof code === 'string' || typeof code === 'number'
        ? { code }
        : {}),
      ...(typeof error.stack === 'string'
        ? { stack: truncate(error.stack, MAX_STACK_LENGTH) }
        : {}),
      ...(cause !== undefined
        ? { cause: normalizeDiagnosticError(cause, depth + 1) }
        : {}),
    };
  }

  if (typeof error === 'object' && error !== null) {
    const name = safeProperty(error, 'name');
    const message = safeProperty(error, 'message');
    const code = safeProperty(error, 'code');
    const stack = safeProperty(error, 'stack');
    const cause = safeProperty(error, 'cause');

    return {
      name: errorText(name, 'UnknownError'),
      message: errorText(message, 'Objeto de erro sem mensagem.'),
      ...(typeof code === 'string' || typeof code === 'number'
        ? { code }
        : {}),
      ...(typeof stack === 'string'
        ? { stack: truncate(stack, MAX_STACK_LENGTH) }
        : {}),
      ...(cause !== undefined
        ? { cause: normalizeDiagnosticError(cause, depth + 1) }
        : {}),
    };
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: truncate(error, MAX_STRING_LENGTH),
    };
  }

  return {
    name: 'UnknownError',
    message: truncate(String(error), MAX_STRING_LENGTH),
  };
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key)/i.test(
    key,
  );
}

function sanitizeJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  key = '',
): DiagnosticJsonValue {
  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return truncate(value, MAX_STRING_LENGTH);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'undefined') {
    return '[undefined]';
  }

  if (typeof value === 'symbol') {
    return truncate(String(value), MAX_STRING_LENGTH);
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeJsonValue(
      normalizeDiagnosticError(value),
      seen,
      depth + 1,
      key,
    );
  }

  if (depth >= MAX_OBJECT_DEPTH) {
    return '[Maximum depth reached]';
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_COLLECTION_ITEMS)
        .map(item => sanitizeJsonValue(item, seen, depth + 1));

      if (value.length > MAX_COLLECTION_ITEMS) {
        items.push(
          `[${value.length - MAX_COLLECTION_ITEMS} items omitted]`,
        );
      }

      return items;
    }

    const result: { [key: string]: DiagnosticJsonValue } = {};
    const entries = Object.entries(value as Record<string, unknown>);

    for (const [entryKey, entryValue] of entries.slice(
      0,
      MAX_COLLECTION_ITEMS,
    )) {
      result[entryKey] = sanitizeJsonValue(
        entryValue,
        seen,
        depth + 1,
        entryKey,
      );
    }

    if (entries.length > MAX_COLLECTION_ITEMS) {
      result.__omittedKeys = entries.length - MAX_COLLECTION_ITEMS;
    }

    return result;
  } catch (error: unknown) {
    return {
      __serializationError: normalizeDiagnosticError(error).message,
    };
  } finally {
    seen.delete(value);
  }
}

function sanitizeDetails(
  details?: DiagnosticDetails,
): { [key: string]: DiagnosticJsonValue } | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized = sanitizeJsonValue(details, new WeakSet<object>(), 0);

  if (
    typeof sanitized === 'object' &&
    sanitized !== null &&
    !Array.isArray(sanitized)
  ) {
    return sanitized;
  }

  return { value: sanitized };
}

function sanitizeEventName(event: string): string {
  let eventText: string;

  try {
    eventText = typeof event === 'string' ? event : String(event);
  } catch {
    eventText = 'diagnostics.invalid_event';
  }

  const normalized = eventText
    .trim()
    .replace(/[\r\n\t]+/g, '_')
    .replace(/\s+/g, '_');

  return truncate(normalized || 'diagnostics.invalid_event', MAX_EVENT_LENGTH);
}

function monotonicNow(): number {
  try {
    if (
      typeof globalThis.performance !== 'undefined' &&
      typeof globalThis.performance.now === 'function'
    ) {
      return Math.round(globalThis.performance.now() * 1000) / 1000;
    }
  } catch {
    // Date.now is an adequate fallback when a monotonic clock is unavailable.
  }

  return Date.now();
}

function createSessionId(): string {
  const cryptoApi = globalThis.crypto as
    | (Crypto & { randomUUID?: () => string })
    | undefined;

  try {
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
  } catch {
    // Some React Native runtimes expose crypto without randomUUID support.
  }

  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compactUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function isoFromMilliseconds(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function isDirectoryPickerCancellation(error: unknown): boolean {
  const normalized = normalizeDiagnosticError(error);
  return /cancel/i.test(`${normalized.name} ${normalized.message}`);
}

class DiagnosticsLogger {
  readonly sessionId = createSessionId();

  private readonly sessionStartedAtUtc = new Date().toISOString();
  private initialized = false;
  private sessionEnded = false;
  private monitoringActive = false;
  private monitoringRunId: string | null = null;
  private monitoringStartedAtUtc: string | null = null;
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private pendingOperations = 0;
  private currentFile: File | null = null;
  private currentFileDate: string | null = null;
  private lastWriteAtUtc: string | null = null;
  private lastHeartbeatAtUtc: string | null = null;
  private lastInternalError: DiagnosticsInternalErrorStatus | null = null;

  initialize(details?: DiagnosticDetails): Promise<void> {
    return this.enqueue('initialize', async () => {
      const preparedDetails = sanitizeDetails(details);
      await this.ensureInitialized(preparedDetails);
    });
  }

  info(event: string, details?: DiagnosticDetails): Promise<void> {
    return this.write('info', event, details);
  }

  warn(event: string, details?: DiagnosticDetails): Promise<void> {
    return this.write('warn', event, details);
  }

  error(
    event: string,
    error?: unknown,
    details?: DiagnosticDetails,
  ): Promise<void> {
    return this.write('error', event, details, error);
  }

  heartbeat(details?: DiagnosticDetails): Promise<void> {
    return this.write('info', 'heartbeat', details, undefined, true);
  }

  markMonitoringActive(details?: DiagnosticDetails): Promise<void> {
    return this.enqueue('markMonitoringActive', async () => {
      await this.ensureInitialized();

      if (this.monitoringActive) {
        this.writeActiveMonitoringMarker();
        return;
      }

      const requestedMonitoringRunId = details?.monitoringRunId;
      const monitoringRunId =
        typeof requestedMonitoringRunId === 'string' &&
        requestedMonitoringRunId.trim()
          ? requestedMonitoringRunId
          : createSessionId();
      const startedAt = new Date();
      this.monitoringActive = true;
      this.monitoringRunId = monitoringRunId;
      this.monitoringStartedAtUtc = startedAt.toISOString();
      this.lastHeartbeatAtUtc = null;

      try {
        const prepared = this.prepareEvent('monitoring_started', {
          ...(details ?? {}),
          monitoringRunId,
        });
        this.appendRecord(this.createRecord('info', prepared));
        this.writeActiveMonitoringMarker();
      } catch (error: unknown) {
        this.monitoringActive = false;
        this.monitoringRunId = null;
        this.monitoringStartedAtUtc = null;
        throw error;
      }
    });
  }

  markMonitoringStopped(details?: DiagnosticDetails): Promise<void> {
    return this.enqueue('markMonitoringStopped', async () => {
      await this.ensureInitialized();

      if (!this.monitoringActive) {
        this.deleteActiveMonitoringMarker();
        return;
      }

      const prepared = this.prepareEvent('monitoring_stopped', {
        ...(details ?? {}),
        monitoringRunId: this.monitoringRunId,
      });
      this.appendRecord(this.createRecord('info', prepared));
      this.deleteActiveMonitoringMarker();
      this.monitoringActive = false;
      this.monitoringRunId = null;
      this.monitoringStartedAtUtc = null;
      this.lastHeartbeatAtUtc = null;
    });
  }

  endSession(details?: DiagnosticDetails): Promise<void> {
    return this.enqueue('endSession', async () => {
      const prepared = this.prepareEvent('session_ended', details);
      await this.ensureInitialized();

      if (this.sessionEnded) {
        return;
      }

      if (this.monitoringActive) {
        const monitoringStopped = this.prepareEvent(
          'monitoring_stopped',
          {
            monitoringRunId: this.monitoringRunId,
            reason: 'session_ended',
          },
        );
        this.appendRecord(this.createRecord('info', monitoringStopped));
        this.deleteActiveMonitoringMarker();
        this.monitoringActive = false;
        this.monitoringRunId = null;
        this.monitoringStartedAtUtc = null;
        this.lastHeartbeatAtUtc = null;
      }

      this.appendRecord(this.createRecord('info', prepared));
      this.sessionEnded = true;
    });
  }

  getStatus(): Promise<DiagnosticsStatus> {
    return this.enqueueResult(
      'getStatus',
      async () => {
        await this.ensureInitialized();
        return this.collectStatus();
      },
      () => this.emptyStatus(),
    );
  }

  async export(): Promise<DiagnosticsExportResult | null> {
    await this.initialize();

    let selectedDirectory: Directory;

    try {
      const pickedDirectory = await Directory.pickDirectoryAsync();
      selectedDirectory = new Directory(pickedDirectory.uri);
    } catch (error: unknown) {
      if (isDirectoryPickerCancellation(error)) {
        await this.info('diagnostics_export_cancelled');
      } else {
        await this.error('diagnostics_export_picker_failed', error);
      }

      return null;
    }

    let exportError: unknown;

    const result = await this.enqueueResult<DiagnosticsExportResult | null>(
      'export',
      async () => {
        try {
          await this.ensureInitialized();

          const exportStarted = this.prepareEvent(
            'diagnostics_export_started',
          );
          this.appendRecord(this.createRecord('info', exportStarted));

          const files = this.listLogFiles();
          const exportedAt = new Date();
          const exportDirectoryName =
            `field-monitoring-diagnostics-${compactUtcTimestamp(exportedAt)}-` +
            this.sessionId.slice(0, 8);
          const exportDirectory = selectedDirectory.createDirectory(
            exportDirectoryName,
          );
          const exportedFileNames: string[] = [];
          let totalBytes = 0;

          for (const source of files) {
            const destination = exportDirectory.createFile(
              source.name,
              'application/x-ndjson',
            );
            const bytes = await source.file.bytes();
            destination.write(bytes);
            exportedFileNames.push(source.name);
            totalBytes += bytes.byteLength;
          }

          const manifestName = 'manifest.json';
          const manifest = exportDirectory.createFile(
            manifestName,
            'application/json',
          );
          manifest.write(
            JSON.stringify(
              {
                schemaVersion: 1,
                exportedAtUtc: exportedAt.toISOString(),
                sessionId: this.sessionId,
                retentionDateCount: RETENTION_DATE_COUNT,
                maxSegmentBytes: MAX_SEGMENT_BYTES,
                fileCount: exportedFileNames.length,
                totalBytes,
                files: exportedFileNames,
              },
              null,
              2,
            ),
          );

          const readmeName = 'LEIA-ME.txt';
          const readme = exportDirectory.createFile(
            readmeName,
            'text/plain',
          );
          readme.write(
            [
              'Diagnosticos de monitoramento de campo',
              '',
              'Os arquivos .jsonl usam JSON Lines: um evento JSON por linha.',
              'O aplicativo mantem as 8 datas UTC mais recentes e segmenta arquivos grandes.',
              '',
              'Para analisar esta pasta no repositorio do app:',
              'npm run diagnostics:analyze -- <pasta/arquivo>',
              '',
            ].join('\n'),
          );

          const exported = {
            exportedAtUtc: exportedAt.toISOString(),
            directoryUri: exportDirectory.uri,
            fileNames: [
              ...exportedFileNames,
              manifestName,
              readmeName,
            ],
            fileCount: exportedFileNames.length,
            totalBytes,
          } satisfies DiagnosticsExportResult;

          const exportSucceeded = this.prepareEvent(
            'diagnostics_export_succeeded',
            {
              fileCount: exported.fileCount,
              totalBytes: exported.totalBytes,
            },
          );
          this.appendRecord(this.createRecord('info', exportSucceeded));

          return exported;
        } catch (error: unknown) {
          exportError = error;
          return null;
        }
      },
      () => null,
    );

    if (exportError !== undefined) {
      await this.error('diagnostics_export_failed', exportError);
    }

    return result;
  }

  private write(
    level: DiagnosticsLevel,
    event: string,
    details?: DiagnosticDetails,
    error?: unknown,
    updateHeartbeatMarker = false,
  ): Promise<void> {
    return this.enqueue(`write:${sanitizeEventName(event)}`, async () => {
      const prepared = this.prepareEvent(event, details, error);
      await this.ensureInitialized();
      const record = this.createRecord(level, prepared);
      this.appendRecord(record);

      if (updateHeartbeatMarker) {
        this.lastHeartbeatAtUtc = record.tsUtc;

        if (this.monitoringActive) {
          this.writeActiveMonitoringMarker();
        }
      }
    });
  }

  private prepareEvent(
    event: string,
    details?: DiagnosticDetails,
    error?: unknown,
  ): PreparedEvent {
    return {
      event: sanitizeEventName(event),
      details: sanitizeDetails(details),
      ...(error !== undefined
        ? { error: normalizeDiagnosticError(error) }
        : {}),
      occurredAt: new Date(),
      monotonicMs: monotonicNow(),
    };
  }

  private createRecord(
    level: DiagnosticsLevel,
    event: PreparedEvent,
  ): DiagnosticRecord {
    this.sequence += 1;

    return {
      schemaVersion: 1,
      tsUtc: event.occurredAt.toISOString(),
      timezoneOffsetMinutes: -event.occurredAt.getTimezoneOffset(),
      monotonicMs: event.monotonicMs,
      sequence: this.sequence,
      sessionId: this.sessionId,
      ...(this.monitoringRunId
        ? { monitoringRunId: this.monitoringRunId }
        : {}),
      level,
      event: event.event,
      ...(event.details ? { details: event.details } : {}),
      ...(event.error ? { error: event.error } : {}),
    };
  }

  private async ensureInitialized(
    initializationDetails?: { [key: string]: DiagnosticJsonValue },
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      diagnosticsDirectory.create({
        idempotent: true,
        intermediates: true,
      });

      this.enforceRetention();

      const previousMonitoring = this.readActiveMonitoringMarker();

      if (
        previousMonitoring &&
        previousMonitoring.sessionId !== this.sessionId
      ) {
        const uncleanEvent = this.prepareEvent(
          'previous_monitoring_unclean',
          {
            previousSessionId: previousMonitoring.sessionId,
            previousMonitoringRunId:
              previousMonitoring.monitoringRunId,
            previousMonitoringStartedAtUtc:
              previousMonitoring.startedAtUtc,
            previousMonitoringLastHeartbeatAtUtc:
              previousMonitoring.lastHeartbeatAtUtc,
          },
        );
        this.appendRecord(this.createRecord('warn', uncleanEvent));
      }

      if (previousMonitoring) {
        this.deleteActiveMonitoringMarker();
      }

      const sessionEvent = this.prepareEvent('session_started', {
        retentionDateCount: RETENTION_DATE_COUNT,
        maxSegmentBytes: MAX_SEGMENT_BYTES,
        ...(initializationDetails
          ? { initialization: initializationDetails }
          : {}),
      });
      this.appendRecord(this.createRecord('info', sessionEvent));
      this.initialized = true;
    } catch (error: unknown) {
      this.initialized = false;
      throw error;
    }
  }

  private appendRecord(record: DiagnosticRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    const bytes = new TextEncoder().encode(line);
    const recordDate = utcDate(new Date(record.tsUtc));
    const changedDate = this.currentFileDate !== recordDate;
    const file = this.resolveLogFile(recordDate, bytes.byteLength);
    const handle = file.open();

    try {
      handle.offset = handle.size ?? file.size;
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }

    this.currentFile = file;
    this.currentFileDate = recordDate;
    this.lastWriteAtUtc = record.tsUtc;

    if (changedDate) {
      this.enforceRetention();
    }
  }

  private resolveLogFile(date: string, incomingBytes: number): File {
    if (
      this.currentFile &&
      this.currentFileDate === date &&
      this.currentFile.exists &&
      this.currentFile.size + incomingBytes <= MAX_SEGMENT_BYTES
    ) {
      return this.currentFile;
    }

    const filesForDate = this.listLogFiles()
      .filter(item => item.date === date)
      .sort((left, right) => left.segment - right.segment);
    const lastFile = filesForDate.at(-1);

    if (
      lastFile &&
      lastFile.sizeBytes + incomingBytes <= MAX_SEGMENT_BYTES
    ) {
      return lastFile.file;
    }

    const segment = lastFile ? lastFile.segment + 1 : 0;
    const fileName =
      `diagnostics-${date}-` +
      `${segment}`.padStart(3, '0') +
      '.jsonl';
    const file = new File(diagnosticsDirectory, fileName);
    file.create();
    return file;
  }

  private listLogFiles(): ParsedLogFile[] {
    if (!diagnosticsDirectory.exists) {
      return [];
    }

    return diagnosticsDirectory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map(file => {
        const match = LOG_FILE_PATTERN.exec(file.name);

        if (!match) {
          return null;
        }

        return {
          file,
          name: file.name,
          date: match[1],
          segment: Number(match[2]),
          sizeBytes: file.size,
        } satisfies ParsedLogFile;
      })
      .filter((entry): entry is ParsedLogFile => entry !== null)
      .sort((left, right) =>
        left.date === right.date
          ? left.segment - right.segment
          : left.date.localeCompare(right.date),
      );
  }

  private enforceRetention(): void {
    const files = this.listLogFiles();
    const retainedDates = [
      ...new Set(files.map(item => item.date)),
    ]
      .sort((left, right) => right.localeCompare(left))
      .slice(0, RETENTION_DATE_COUNT);
    const retainedDateSet = new Set(retainedDates);

    for (const item of files) {
      if (retainedDateSet.has(item.date)) {
        continue;
      }

      try {
        item.file.delete();

        if (this.currentFile?.uri === item.file.uri) {
          this.currentFile = null;
          this.currentFileDate = null;
        }
      } catch (error: unknown) {
        this.captureInternalError('retention.delete', error);
      }
    }
  }

  private activeMonitoringFile(): File {
    return new File(diagnosticsDirectory, ACTIVE_MONITORING_FILE_NAME);
  }

  private readActiveMonitoringMarker(): ActiveMonitoringMarker | null {
    const markerFile = this.activeMonitoringFile();

    if (!markerFile.exists) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(markerFile.textSync());

      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      const candidate = parsed as Record<string, unknown>;

      if (
        candidate.schemaVersion !== 1 ||
        candidate.active !== true ||
        typeof candidate.sessionId !== 'string' ||
        typeof candidate.monitoringRunId !== 'string' ||
        typeof candidate.startedAtUtc !== 'string'
      ) {
        return null;
      }

      return {
        schemaVersion: 1,
        active: true,
        sessionId: candidate.sessionId,
        monitoringRunId: candidate.monitoringRunId,
        startedAtUtc: candidate.startedAtUtc,
        lastHeartbeatAtUtc:
          typeof candidate.lastHeartbeatAtUtc === 'string'
            ? candidate.lastHeartbeatAtUtc
            : null,
      };
    } catch (error: unknown) {
      this.captureInternalError('monitoringMarker.read', error);
      return null;
    }
  }

  private writeActiveMonitoringMarker(): void {
    if (
      !this.monitoringActive ||
      !this.monitoringRunId ||
      !this.monitoringStartedAtUtc
    ) {
      return;
    }

    try {
      const markerFile = this.activeMonitoringFile();
      markerFile.write(
        JSON.stringify({
          schemaVersion: 1,
          active: true,
          sessionId: this.sessionId,
          monitoringRunId: this.monitoringRunId,
          startedAtUtc: this.monitoringStartedAtUtc,
          lastHeartbeatAtUtc: this.lastHeartbeatAtUtc,
        } satisfies ActiveMonitoringMarker),
      );
    } catch (error: unknown) {
      this.captureInternalError('monitoringMarker.write', error);
    }
  }

  private deleteActiveMonitoringMarker(): void {
    try {
      const markerFile = this.activeMonitoringFile();

      if (markerFile.exists) {
        markerFile.delete();
      }
    } catch (error: unknown) {
      this.captureInternalError('monitoringMarker.delete', error);
    }
  }

  private collectStatus(): DiagnosticsStatus {
    const files = this.listLogFiles();
    const dates = [...new Set(files.map(file => file.date))].sort(
      (left, right) => left.localeCompare(right),
    );

    return {
      initialized: this.initialized,
      sessionId: this.sessionId,
      sessionStartedAtUtc: this.sessionStartedAtUtc,
      sessionEnded: this.sessionEnded,
      monitoringActive: this.monitoringActive,
      monitoringRunId: this.monitoringRunId,
      monitoringStartedAtUtc: this.monitoringStartedAtUtc,
      lastHeartbeatAtUtc: this.lastHeartbeatAtUtc,
      directoryUri: diagnosticsDirectory.uri,
      retentionDateCount: RETENTION_DATE_COUNT,
      maxSegmentBytes: MAX_SEGMENT_BYTES,
      pendingOperations: Math.max(0, this.pendingOperations - 1),
      currentFileName: this.currentFile?.name ?? null,
      lastWriteAtUtc: this.lastWriteAtUtc,
      fileCount: files.length,
      retainedDates: dates,
      totalBytes: files.reduce(
        (total, file) => total + file.sizeBytes,
        0,
      ),
      availableDiskBytes: this.readDiskSpace('available'),
      totalDiskBytes: this.readDiskSpace('total'),
      files: files.map(item => ({
        name: item.name,
        date: item.date,
        segment: item.segment,
        sizeBytes: item.sizeBytes,
        modifiedAtUtc: isoFromMilliseconds(item.file.modificationTime),
      })),
      lastInternalError: this.lastInternalError,
    };
  }

  private emptyStatus(): DiagnosticsStatus {
    return {
      initialized: this.initialized,
      sessionId: this.sessionId,
      sessionStartedAtUtc: this.sessionStartedAtUtc,
      sessionEnded: this.sessionEnded,
      monitoringActive: this.monitoringActive,
      monitoringRunId: this.monitoringRunId,
      monitoringStartedAtUtc: this.monitoringStartedAtUtc,
      lastHeartbeatAtUtc: this.lastHeartbeatAtUtc,
      directoryUri: diagnosticsDirectory.uri,
      retentionDateCount: RETENTION_DATE_COUNT,
      maxSegmentBytes: MAX_SEGMENT_BYTES,
      pendingOperations: Math.max(0, this.pendingOperations - 1),
      currentFileName: this.currentFile?.name ?? null,
      lastWriteAtUtc: this.lastWriteAtUtc,
      fileCount: 0,
      retainedDates: [],
      totalBytes: 0,
      availableDiskBytes: this.readDiskSpace('available'),
      totalDiskBytes: this.readDiskSpace('total'),
      files: [],
      lastInternalError: this.lastInternalError,
    };
  }

  private readDiskSpace(kind: 'available' | 'total'): number | null {
    try {
      const value =
        kind === 'available'
          ? Paths.availableDiskSpace
          : Paths.totalDiskSpace;
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  private enqueue(
    operation: string,
    task: () => void | Promise<void>,
  ): Promise<void> {
    return this.enqueueResult(operation, task, () => undefined);
  }

  private enqueueResult<T>(
    operation: string,
    task: () => T | Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    this.pendingOperations += 1;

    const execute = async (): Promise<T> => {
      try {
        return await task();
      } catch (error: unknown) {
        this.captureInternalError(operation, error);
        return fallback();
      } finally {
        this.pendingOperations = Math.max(0, this.pendingOperations - 1);
      }
    };

    const result = this.queue.then(execute, execute);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private captureInternalError(operation: string, error: unknown): void {
    let normalized: NormalizedDiagnosticError;

    try {
      normalized = normalizeDiagnosticError(error);
    } catch {
      normalized = {
        name: 'DiagnosticsInternalError',
        message: 'Nao foi possivel normalizar a falha interna do logger.',
      };
    }

    this.lastInternalError = {
      atUtc: new Date().toISOString(),
      operation,
      error: normalized,
    };

    // This is the final fallback when the persistent logger itself cannot write.
    try {
      console.error(
        `[diagnostics:${operation}] ${normalized.name}: ${normalized.message}`,
      );
    } catch {
      // There is no additional fallback when even the runtime console fails.
    }
  }
}

export const diagnostics = new DiagnosticsLogger();

export const DIAGNOSTICS_CONFIG = Object.freeze({
  directoryName: DIAGNOSTICS_DIRECTORY_NAME,
  retentionDateCount: RETENTION_DATE_COUNT,
  maxSegmentBytes: MAX_SEGMENT_BYTES,
  schemaVersion: 1 as const,
});
