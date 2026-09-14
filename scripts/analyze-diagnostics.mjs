#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const DEFAULT_HEARTBEAT_GAP_MS = 150_000;
const MAX_GROUPS_IN_REPORT = 15;

function usage() {
  return `Uso:
  npm run diagnostics:analyze -- <arquivo-ou-diretorio> [...outros]
  npm run diagnostics:analyze -- --json <arquivo-ou-diretorio>
  cat diagnostics.jsonl | npm run diagnostics:analyze -- -

Opcoes:
  --json                    Imprime o relatorio como JSON.
  --heartbeat-gap-ms <ms>   Limite para considerar um gap (padrao: ${DEFAULT_HEARTBEAT_GAP_MS}).
  -h, --help                Mostra esta ajuda.`;
}

function parseArguments(argv) {
  const options = {
    json: false,
    heartbeatGapMs: DEFAULT_HEARTBEAT_GAP_MS,
    inputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '-h' || argument === '--help') {
      return { ...options, help: true };
    }

    if (argument === '--heartbeat-gap-ms') {
      const value = Number(argv[index + 1]);

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--heartbeat-gap-ms precisa ser um numero positivo.');
      }

      options.heartbeatGapMs = value;
      index += 1;
      continue;
    }

    if (argument.startsWith('--heartbeat-gap-ms=')) {
      const value = Number(argument.split('=', 2)[1]);

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--heartbeat-gap-ms precisa ser um numero positivo.');
      }

      options.heartbeatGapMs = value;
      continue;
    }

    if (argument.startsWith('-') && argument !== '-') {
      throw new Error(`Opcao desconhecida: ${argument}`);
    }

    options.inputs.push(argument);
  }

  return options;
}

async function collectInputFiles(input, fromDirectory = false) {
  const absolutePath = resolve(input);
  const inputStat = await lstat(absolutePath);

  if (inputStat.isFile()) {
    if (
      fromDirectory &&
      !absolutePath.endsWith('.jsonl') &&
      !absolutePath.endsWith('.ndjson')
    ) {
      return [];
    }

    return [absolutePath];
  }

  if (!inputStat.isDirectory()) {
    return [];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries
      .filter(entry => !entry.isSymbolicLink())
      .map(entry =>
        collectInputFiles(
          resolve(absolutePath, entry.name),
          true,
        ),
      ),
  );

  return nestedFiles.flat();
}

function canonicalEvent(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[.-]/g, '_')
    : 'invalid_event';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function timestampMs(record) {
  const raw = record.tsUtc ?? record.timestamp ?? record.ts;

  if (typeof raw !== 'string') {
    return null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function detailNumber(details, keys) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  for (const key of keys) {
    const value = finiteNumber(details[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function detailText(details, keys, fallback = '-') {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return fallback;
  }

  for (const key of keys) {
    const value = details[key];

    if (typeof value === 'string' && value) {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }
  }

  return fallback;
}

function errorIdentity(record, event) {
  const error =
    record.error && typeof record.error === 'object' ? record.error : {};
  const stage = detailText(record.details, ['stage', 'captureStage']);
  const code =
    typeof error.code === 'string' || typeof error.code === 'number'
      ? String(error.code)
      : detailText(record.details, ['code', 'errorCode']);
  const message =
    typeof error.message === 'string'
      ? error.message
      : detailText(record.details, ['message', 'errorMessage']);

  return {
    key: `${event}\u0000${stage}\u0000${code}\u0000${message}`,
    event,
    stage,
    code,
    message,
  };
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function createSummary(heartbeatGapMs) {
  return {
    heartbeatGapMs,
    inputFiles: [],
    inputBytes: 0,
    lines: 0,
    records: 0,
    duplicates: 0,
    invalidLines: 0,
    invalidExamples: [],
    schemaVersions: new Set(),
    firstTimestampMs: null,
    lastTimestampMs: null,
    levels: new Map(),
    events: new Map(),
    sessions: new Map(),
    seenRecords: new Set(),
    heartbeatGapDurations: [],
    heartbeatGapExamples: [],
    sequenceGaps: 0,
    sequenceRegressions: 0,
    captures: {
      started: 0,
      succeeded: 0,
      failed: 0,
      timedOut: 0,
      lastSuccessMs: null,
      successTimestamps: [],
    },
    durationsMs: [],
    schedulerDriftsMs: [],
    errors: new Map(),
    previousUncleanSessions: 0,
    storage: {
      firstAvailableBytes: null,
      latestAvailableBytes: null,
      minimumAvailableBytes: null,
      latestTimestampMs: null,
    },
  };
}

function sessionFor(summary, sessionId) {
  const normalizedSessionId =
    typeof sessionId === 'string' && sessionId
      ? sessionId
      : '(sem sessionId)';
  let session = summary.sessions.get(normalizedSessionId);

  if (!session) {
    session = {
      sessionId: normalizedSessionId,
      records: 0,
      heartbeats: 0,
      firstTimestampMs: null,
      lastTimestampMs: null,
      lastHeartbeatMs: null,
      lastSequence: null,
      ended: false,
    };
    summary.sessions.set(normalizedSessionId, session);
  }

  return session;
}

function updateRange(target, timestamp) {
  if (timestamp === null) {
    return;
  }

  target.firstTimestampMs =
    target.firstTimestampMs === null
      ? timestamp
      : Math.min(target.firstTimestampMs, timestamp);
  target.lastTimestampMs =
    target.lastTimestampMs === null
      ? timestamp
      : Math.max(target.lastTimestampMs, timestamp);
}

function processRecord(summary, record, source, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('A linha JSON nao contem um objeto.');
  }

  const event = canonicalEvent(record.event);
  const sessionId =
    typeof record.sessionId === 'string' ? record.sessionId : null;
  const sequence = finiteNumber(record.sequence);
  const identity =
    sessionId && sequence !== null ? `${sessionId}:${sequence}` : null;

  if (identity && summary.seenRecords.has(identity)) {
    summary.duplicates += 1;
    return;
  }

  if (identity) {
    summary.seenRecords.add(identity);
  }

  const timestamp = timestampMs(record);
  const level =
    typeof record.level === 'string' ? record.level.toLowerCase() : 'unknown';
  const session = sessionFor(summary, sessionId);

  summary.records += 1;
  increment(summary.events, event);
  increment(summary.levels, level);
  updateRange(summary, timestamp);
  updateRange(session, timestamp);
  session.records += 1;

  if (record.schemaVersion !== undefined) {
    summary.schemaVersions.add(String(record.schemaVersion));
  }

  if (sequence !== null) {
    if (session.lastSequence !== null) {
      if (sequence > session.lastSequence + 1) {
        summary.sequenceGaps += sequence - session.lastSequence - 1;
      } else if (sequence <= session.lastSequence) {
        summary.sequenceRegressions += 1;
      }
    }

    session.lastSequence = sequence;
  }

  if (event === 'heartbeat') {
    session.heartbeats += 1;

    if (
      timestamp !== null &&
      session.lastHeartbeatMs !== null &&
      timestamp > session.lastHeartbeatMs
    ) {
      const gap = timestamp - session.lastHeartbeatMs;

      if (gap > summary.heartbeatGapMs) {
        summary.heartbeatGapDurations.push(gap);

        if (summary.heartbeatGapExamples.length < 10) {
          summary.heartbeatGapExamples.push({
            sessionId: session.sessionId,
            fromUtc: new Date(session.lastHeartbeatMs).toISOString(),
            toUtc: new Date(timestamp).toISOString(),
            durationMs: gap,
          });
        }
      }
    }

    if (timestamp !== null) {
      session.lastHeartbeatMs = Math.max(
        session.lastHeartbeatMs ?? timestamp,
        timestamp,
      );
    }
  }

  if (event === 'session_ended') {
    session.ended = true;
  }

  if (
    event === 'previous_session_unclean' ||
    event === 'previous_monitoring_unclean'
  ) {
    summary.previousUncleanSessions += 1;
  }

  if (event === 'capture_started') {
    summary.captures.started += 1;
  } else if (
    event === 'capture_succeeded' ||
    event === 'capture_success' ||
    event === 'photo_saved'
  ) {
    summary.captures.succeeded += 1;

    if (timestamp !== null) {
      summary.captures.lastSuccessMs = Math.max(
        summary.captures.lastSuccessMs ?? timestamp,
        timestamp,
      );
      summary.captures.successTimestamps.push(timestamp);
    }
  } else if (event === 'capture_failed' || event === 'capture_failure') {
    summary.captures.failed += 1;

    if (
      detailText(record.details, ['reason', 'failureReason'], '')
        .toLowerCase()
        .includes('timeout')
    ) {
      summary.captures.timedOut += 1;
    }
  } else if (
    event === 'capture_timeout' ||
    (event.startsWith('capture_') && event.endsWith('_timeout'))
  ) {
    summary.captures.timedOut += 1;
  }

  const duration = detailNumber(record.details, [
    'durationMs',
    'elapsedMs',
  ]);
  const drift = detailNumber(record.details, [
    'driftMs',
    'schedulerDriftMs',
  ]);

  if (duration !== null && duration >= 0) {
    summary.durationsMs.push(duration);
  }

  if (drift !== null) {
    summary.schedulerDriftsMs.push(drift);
  }

  const availableBytes = detailNumber(record.details, [
    'availableDiskBytes',
    'availableDiskSpace',
    'freeDiskBytes',
    'storageAvailableBytes',
  ]);

  if (availableBytes !== null && availableBytes >= 0) {
    if (summary.storage.firstAvailableBytes === null) {
      summary.storage.firstAvailableBytes = availableBytes;
    }

    summary.storage.minimumAvailableBytes = Math.min(
      summary.storage.minimumAvailableBytes ?? availableBytes,
      availableBytes,
    );

    if (
      timestamp === null ||
      summary.storage.latestTimestampMs === null ||
      timestamp >= summary.storage.latestTimestampMs
    ) {
      summary.storage.latestAvailableBytes = availableBytes;
      summary.storage.latestTimestampMs = timestamp;
    }
  }

  if (
    level === 'error' ||
    record.error ||
    /(?:failed|failure|error|timeout)$/.test(event)
  ) {
    const identityData = errorIdentity(record, event);
    const existing = summary.errors.get(identityData.key);

    if (existing) {
      existing.count += 1;

      if (timestamp !== null) {
        existing.lastTimestampMs = Math.max(
          existing.lastTimestampMs ?? timestamp,
          timestamp,
        );
      }
    } else {
      summary.errors.set(identityData.key, {
        ...identityData,
        count: 1,
        firstTimestampMs: timestamp,
        lastTimestampMs: timestamp,
        source,
        lineNumber,
      });
    }
  }
}

async function analyzeStream(summary, stream, source) {
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  for await (const line of reader) {
    lineNumber += 1;
    summary.lines += 1;

    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      processRecord(summary, record, source, lineNumber);
    } catch (error) {
      summary.invalidLines += 1;

      if (summary.invalidExamples.length < 5) {
        summary.invalidExamples.push({
          source,
          lineNumber,
          message: error instanceof Error ? error.message : String(error),
          excerpt: line.slice(0, 160),
        });
      }
    }
  }
}

function quantile(values, fraction) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

function statistics(values) {
  if (values.length === 0) {
    return { count: 0, p50: null, p95: null, max: null };
  }

  return {
    count: values.length,
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    max: values.reduce(
      (maximum, value) => Math.max(maximum, value),
      Number.NEGATIVE_INFINITY,
    ),
  };
}

function sortedCounts(map, limit = Number.POSITIVE_INFINITY) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.name.localeCompare(right.name)
        : right.count - left.count,
    )
    .slice(0, limit);
}

function finalize(summary) {
  const successTimestamps = [...summary.captures.successTimestamps].sort(
    (left, right) => left - right,
  );
  const captureSuccessGaps = [];

  for (let index = 1; index < successTimestamps.length; index += 1) {
    captureSuccessGaps.push(
      successTimestamps[index] - successTimestamps[index - 1],
    );
  }

  const errorGroups = [...summary.errors.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_GROUPS_IN_REPORT)
    .map(group => ({
      ...group,
      firstTimestampUtc:
        group.firstTimestampMs === null
          ? null
          : new Date(group.firstTimestampMs).toISOString(),
      lastTimestampUtc:
        group.lastTimestampMs === null
          ? null
          : new Date(group.lastTimestampMs).toISOString(),
    }));

  return {
    generatedAtUtc: new Date().toISOString(),
    inputs: {
      files: summary.inputFiles,
      bytes: summary.inputBytes,
      lines: summary.lines,
      records: summary.records,
      duplicateRecordsIgnored: summary.duplicates,
      invalidLines: summary.invalidLines,
      invalidExamples: summary.invalidExamples,
      schemaVersions: [...summary.schemaVersions].sort(),
    },
    period: {
      fromUtc:
        summary.firstTimestampMs === null
          ? null
          : new Date(summary.firstTimestampMs).toISOString(),
      toUtc:
        summary.lastTimestampMs === null
          ? null
          : new Date(summary.lastTimestampMs).toISOString(),
      durationMs:
        summary.firstTimestampMs === null || summary.lastTimestampMs === null
          ? null
          : summary.lastTimestampMs - summary.firstTimestampMs,
    },
    levels: Object.fromEntries(summary.levels),
    topEvents: sortedCounts(summary.events, 20),
    sessions: {
      count: summary.sessions.size,
      previousUncleanSessions: summary.previousUncleanSessions,
      sequenceGaps: summary.sequenceGaps,
      sequenceRegressions: summary.sequenceRegressions,
      items: [...summary.sessions.values()].map(session => ({
        sessionId: session.sessionId,
        records: session.records,
        heartbeats: session.heartbeats,
        ended: session.ended,
        fromUtc:
          session.firstTimestampMs === null
            ? null
            : new Date(session.firstTimestampMs).toISOString(),
        toUtc:
          session.lastTimestampMs === null
            ? null
            : new Date(session.lastTimestampMs).toISOString(),
      })),
    },
    heartbeat: {
      gapThresholdMs: summary.heartbeatGapMs,
      gaps: statistics(summary.heartbeatGapDurations),
      examples: summary.heartbeatGapExamples,
    },
    captures: {
      started: summary.captures.started,
      succeeded: summary.captures.succeeded,
      failed: summary.captures.failed,
      timedOut: summary.captures.timedOut,
      successRate:
        summary.captures.started > 0
          ? summary.captures.succeeded / summary.captures.started
          : null,
      lastSuccessUtc:
        summary.captures.lastSuccessMs === null
          ? null
          : new Date(summary.captures.lastSuccessMs).toISOString(),
      successGapsMs: statistics(captureSuccessGaps),
    },
    timings: {
      durationsMs: statistics(summary.durationsMs),
      schedulerDriftsMs: statistics(summary.schedulerDriftsMs),
    },
    storage: {
      firstAvailableBytes: summary.storage.firstAvailableBytes,
      latestAvailableBytes: summary.storage.latestAvailableBytes,
      minimumAvailableBytes: summary.storage.minimumAvailableBytes,
      consumedBytes:
        summary.storage.firstAvailableBytes !== null &&
        summary.storage.latestAvailableBytes !== null
          ? summary.storage.firstAvailableBytes -
            summary.storage.latestAvailableBytes
          : null,
    },
    errorGroups,
  };
}

function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Math.abs(value);
  let unit = 0;

  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }

  const signedAmount = value < 0 ? -amount : amount;
  return `${signedAmount.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function formatDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  if (Math.abs(value) < 1000) {
    return `${Math.round(value)} ms`;
  }

  const seconds = value / 1000;

  if (Math.abs(seconds) < 60) {
    return `${seconds.toFixed(2)} s`;
  }

  const minutes = seconds / 60;

  if (Math.abs(minutes) < 60) {
    return `${minutes.toFixed(2)} min`;
  }

  const hours = minutes / 60;

  if (Math.abs(hours) < 48) {
    return `${hours.toFixed(2)} h`;
  }

  return `${(hours / 24).toFixed(2)} d`;
}

function formatPercent(value) {
  return value === null ? '-' : `${(value * 100).toFixed(2)}%`;
}

function formatHuman(report) {
  const lines = [
    'Relatorio de diagnosticos de monitoramento de campo',
    `Periodo: ${report.period.fromUtc ?? '-'} -> ${report.period.toUtc ?? '-'} (${formatDuration(report.period.durationMs)})`,
    `Entrada: ${report.inputs.files.length} arquivo(s), ${formatBytes(report.inputs.bytes)}, ${report.inputs.records} registro(s)`,
    `Integridade: ${report.inputs.invalidLines} linha(s) invalida(s), ${report.inputs.duplicateRecordsIgnored} duplicata(s) ignorada(s), schemas ${report.inputs.schemaVersions.join(', ') || '-'}`,
    '',
    'Sessoes e heartbeat',
    `Sessoes: ${report.sessions.count}; encerramentos anteriores nao limpos: ${report.sessions.previousUncleanSessions}`,
    `Sequencias ausentes: ${report.sessions.sequenceGaps}; regressoes: ${report.sessions.sequenceRegressions}`,
    `Gaps de heartbeat > ${formatDuration(report.heartbeat.gapThresholdMs)}: ${report.heartbeat.gaps.count}; maior: ${formatDuration(report.heartbeat.gaps.max)}`,
    '',
    'Capturas',
    `Iniciadas: ${report.captures.started}; sucesso: ${report.captures.succeeded}; falha: ${report.captures.failed}; timeout: ${report.captures.timedOut}`,
    `Taxa de sucesso: ${formatPercent(report.captures.successRate)}; ultimo sucesso: ${report.captures.lastSuccessUtc ?? '-'}`,
    `Maior intervalo entre sucessos: ${formatDuration(report.captures.successGapsMs.max)}`,
    `Duracoes p50/p95/max: ${formatDuration(report.timings.durationsMs.p50)} / ${formatDuration(report.timings.durationsMs.p95)} / ${formatDuration(report.timings.durationsMs.max)}`,
    `Drift p50/p95/max: ${formatDuration(report.timings.schedulerDriftsMs.p50)} / ${formatDuration(report.timings.schedulerDriftsMs.p95)} / ${formatDuration(report.timings.schedulerDriftsMs.max)}`,
    '',
    'Armazenamento',
    `Disponivel inicial/atual/minimo: ${formatBytes(report.storage.firstAvailableBytes)} / ${formatBytes(report.storage.latestAvailableBytes)} / ${formatBytes(report.storage.minimumAvailableBytes)}`,
    `Consumo observado: ${formatBytes(report.storage.consumedBytes)}`,
    '',
    'Eventos mais frequentes',
    ...report.topEvents.map(item => `  ${item.count.toString().padStart(7)}  ${item.name}`),
    '',
    'Erros agrupados',
  ];

  if (report.errorGroups.length === 0) {
    lines.push('  Nenhum erro encontrado.');
  } else {
    for (const group of report.errorGroups) {
      lines.push(
        `  ${group.count}x ${group.event} stage=${group.stage} code=${group.code}`,
      );
      lines.push(`      ${group.message}`);
      lines.push(`      ultimo=${group.lastTimestampUtc ?? '-'}`);
    }
  }

  if (report.heartbeat.examples.length > 0) {
    lines.push('', 'Exemplos de gaps de heartbeat');

    for (const gap of report.heartbeat.examples) {
      lines.push(
        `  ${gap.sessionId}: ${gap.fromUtc} -> ${gap.toUtc} (${formatDuration(gap.durationMs)})`,
      );
    }
  }

  if (report.inputs.invalidExamples.length > 0) {
    lines.push('', 'Exemplos de linhas invalidas');

    for (const invalid of report.inputs.invalidExamples) {
      lines.push(
        `  ${invalid.source}:${invalid.lineNumber}: ${invalid.message}`,
      );
    }
  }

  return lines.join('\n');
}

async function main() {
  let options;

  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.inputs.length === 0) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.inputs.filter(input => input === '-').length > 1) {
    console.error('A entrada padrao (-) so pode ser informada uma vez.');
    process.exitCode = 2;
    return;
  }

  const summary = createSummary(options.heartbeatGapMs);
  const fileInputs = options.inputs.filter(input => input !== '-');
  let files;

  try {
    const collected = await Promise.all(
      fileInputs.map(input => collectInputFiles(input)),
    );
    files = [...new Set(collected.flat())].sort();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (files.length === 0 && !options.inputs.includes('-')) {
    console.error('Nenhum arquivo JSONL/NDJSON encontrado.');
    process.exitCode = 2;
    return;
  }

  for (const file of files) {
    summary.inputFiles.push(file);
    summary.inputBytes += (await stat(file)).size;
    await analyzeStream(summary, createReadStream(file), file);
  }

  if (options.inputs.includes('-')) {
    summary.inputFiles.push('<stdin>');
    await analyzeStream(summary, process.stdin, '<stdin>');
  }

  const report = finalize(summary);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }

  if (report.inputs.records === 0) {
    process.exitCode = 1;
  }
}

await main();
