# Diagnósticos persistentes

O módulo `src/services/diagnostics.ts` grava eventos estruturados no armazenamento
persistente privado do aplicativo. Ele foi desenhado para uma execução contínua de
sete dias e para continuar útil quando a rede ou o servidor de upload estiverem
indisponíveis.

> O serviço é intencionalmente independente. Criar o módulo não inicia a coleta
> sozinho: o ponto de entrada, o monitoramento e o pipeline da câmera devem chamar
> os métodos descritos abaixo.

## Armazenamento e retenção

- Diretório lógico: `Paths.document/diagnostics`.
- Arquivos: `diagnostics-AAAA-MM-DD-NNN.jsonl`, usando a data UTC.
- Rotação: uma nova data sempre abre outro arquivo; cada segmento é limitado a
  aproximadamente 10 MiB.
- Retenção: as oito datas UTC mais recentes, isto é, o dia atual e até sete datas
  anteriores quando o app registra todos os dias.
- Formato: JSON Lines/NDJSON, com exatamente um objeto JSON por linha.
- Escrita: uma fila serial abre o arquivo, posiciona o cursor no final, grava uma
  linha e fecha o handle. Isso evita concorrência e limita uma eventual corrupção
  por encerramento abrupto à última linha incompleta.

`Paths.document` sobrevive a reinícios do processo e atualizações normais do app.
Os arquivos são removidos se o usuário desinstalar o app ou limpar seus dados. A
exportação periódica continua necessária quando a cópia precisa sobreviver à perda
ou substituição do aparelho.

O arquivo auxiliar `active-monitoring.json` só existe entre
`markMonitoringActive()` e `markMonitoringStopped()`. Na próxima inicialização, um
marcador ainda ativo gera `previous_monitoring_unclean`, junto ao horário do último
heartbeat persistido, e então é removido. Abrir e fechar apenas o menu não cria o
marcador e, portanto, não produz um falso encerramento sujo.

## Contrato público

```ts
import { diagnostics } from './services/diagnostics';

await diagnostics.initialize({
  appVersion: '1.0.0',
  nativeBuild: '42',
  gitCommit: 'abc1234',
});

await diagnostics.markMonitoringActive({
  intervalMs: 60_000,
});

await diagnostics.warn('camera_ready_slow', {
  captureId: 'capture-123',
  durationMs: 8_500,
});

await diagnostics.error('capture_stage_failed', error, {
  captureId: 'capture-123',
  stage: 'media_library',
  durationMs: 31_250,
});

await diagnostics.heartbeat({
  appState: 'active',
  captureInFlight: false,
  nextCaptureAtUtc: '2026-08-25T18:00:00.000Z',
  availableDiskBytes: 9_876_543_210,
});

await diagnostics.markMonitoringStopped({ reason: 'user_requested' });
```

O singleton exporta:

| Método/propriedade | Retorno | Comportamento |
| --- | --- | --- |
| `diagnostics.sessionId` | `string` | Identificador da execução atual, incluído em todas as linhas. |
| `initialize(details?)` | `Promise<void>` | Cria o diretório, aplica retenção e registra `session_started`. É idempotente. |
| `info(event, details?)` | `Promise<void>` | Registra um evento informativo. |
| `warn(event, details?)` | `Promise<void>` | Registra um alerta recuperável. |
| `error(event, error?, details?)` | `Promise<void>` | Registra erro com `name`, `message`, `code`, `stack` e `cause` normalizados. |
| `heartbeat(details?)` | `Promise<void>` | Registra `heartbeat` e, durante uma execução ativa, atualiza seu horário no marcador de monitoramento. |
| `markMonitoringActive(details?)` | `Promise<void>` | Abre uma execução, usa `details.monitoringRunId` quando informado (ou gera um), registra `monitoring_started` e cria o marcador persistente. É idempotente enquanto já estiver ativa. |
| `markMonitoringStopped(details?)` | `Promise<void>` | Registra `monitoring_stopped`, remove o marcador e permite iniciar outra execução na mesma sessão. |
| `getStatus()` | `Promise<DiagnosticsStatus>` | Retorna arquivos, datas, bytes, espaço em disco, fila e última falha interna. |
| `export()` | `Promise<DiagnosticsExportResult \| null>` | Abre o seletor de diretório e copia logs, `manifest.json` e `LEIA-ME.txt`; retorna `null` em cancelamento/falha. |
| `endSession(details?)` | `Promise<void>` | Encerra um monitoramento ainda ativo, registra `session_ended` e limpa o marcador. |

As operações públicas absorvem falhas de filesystem para não interromper a captura.
Quando nem o arquivo persistente pode ser escrito, a última alternativa é
`console.error`; `getStatus().lastInternalError` preserva o último erro observado
em memória.

`DIAGNOSTICS_CONFIG` e os tipos `DiagnosticRecord`, `DiagnosticDetails`,
`NormalizedDiagnosticError`, `DiagnosticsStatus` e `DiagnosticsExportResult`
também são exportados.

## Esquema de cada linha

```json
{
  "schemaVersion": 1,
  "tsUtc": "2026-08-25T17:42:31.042Z",
  "timezoneOffsetMinutes": -180,
  "monotonicMs": 928104.733,
  "sequence": 318,
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "monitoringRunId": "00000000-0000-4000-8000-000000000002",
  "level": "error",
  "event": "capture_stage_failed",
  "details": {
    "captureId": "capture-123",
    "stage": "media_library",
    "durationMs": 31250,
    "availableDiskBytes": 9876543210
  },
  "error": {
    "name": "Error",
    "message": "Falha ao criar o asset",
    "code": "E_MEDIA_LIBRARY",
    "stack": "..."
  }
}
```

Regras relevantes:

- `tsUtc` registra o instante civil; `monotonicMs` permite medir duração sem ser
  afetado por ajustes no relógio do aparelho.
- `timezoneOffsetMinutes` segue a convenção UTC (`-180` para UTC-03:00).
- A sequência cresce dentro da sessão e ajuda a detectar linhas ausentes.
- `monitoringRunId` aparece automaticamente enquanto uma execução está ativa e
  separa várias rodadas iniciadas na mesma abertura do aplicativo.
- Objetos cíclicos, `BigInt`, funções e valores não finitos são convertidos para
  representações JSON seguras.
- Strings, pilhas e coleções têm limites para impedir que um único evento ocupe o
  segmento inteiro.
- Chaves com nomes de senha, token, cookie, autorização, segredo ou API key são
  substituídas por `[REDACTED]`.

Mesmo com a proteção automática, não inclua bytes/base64 de fotografias,
credenciais, hostname sensível ou URI absoluta da imagem nos detalhes.

## Eventos recomendados para a câmera

Use um `captureId` único desde o agendamento até o resultado final. Estes nomes são
reconhecidos diretamente pelo analisador:

- `monitoring_started`, `monitoring_stopped`;
- `schedule_set`, `timer_fired` com `driftMs`;
- `camera_mount_started`, `camera_ready`, `camera_mount_failed`,
  `camera_ready_timeout`;
- `capture_started`, `capture_stage_started`, `capture_stage_succeeded`,
  `capture_stage_failed`, `capture_timeout`, `capture_succeeded`,
  `capture_failed`;
- `permission_changed`, `app_state_changed`, `storage_low`;
- `heartbeat` a cada 60 segundos enquanto o monitoramento estiver ativo.

Estágios sugeridos: `precondition`, `camera_ready`, `take_picture`, `temp_move`,
`media_library`, `cleanup` e `haptics`. Registre `durationMs`, status das permissões,
estado do app, captura em andamento, próximo horário planejado, último sucesso,
falhas consecutivas e `availableDiskBytes` no heartbeat.

Um heartbeat não substitui watchdogs. `onCameraReady`, `takePictureAsync` e a cópia
para a biblioteca precisam de limites próprios; o evento de timeout deve ser
gravado antes de liberar o ciclo e agendar a próxima tentativa.

## Status e exportação

```ts
const status = await diagnostics.getStatus();

console.log({
  files: status.fileCount,
  dates: status.retainedDates,
  bytes: status.totalBytes,
  free: status.availableDiskBytes,
  lastWrite: status.lastWriteAtUtc,
  loggerError: status.lastInternalError,
});

const exported = await diagnostics.export();

if (exported) {
  console.log(exported.directoryUri, exported.fileNames);
}
```

`export()` abre `Directory.pickDirectoryAsync()`, cria uma subpasta como
`field-monitoring-diagnostics-20260825T174231042Z-00000000` e copia todos os segmentos
retidos. A subpasta contém também `manifest.json` e um `LEIA-ME.txt` com o formato,
a retenção e o comando do analisador. No Android, isso funciona com o Storage
Access Framework sem exigir um caminho externo fixo. No iOS, a permissão para o
diretório escolhido vale somente durante a sessão atual.

O campo `fileCount` do resultado conta segmentos JSONL; `fileNames` inclui também
o manifesto e o `LEIA-ME.txt`.

## Analisador

O analisador usa apenas módulos nativos do Node.js:

```bash
npm run diagnostics:analyze -- ./exportado/field-monitoring-diagnostics-...
npm run diagnostics:analyze -- --json ./diagnostics-2026-08-25-000.jsonl
npm run diagnostics:analyze -- --heartbeat-gap-ms 180000 ./exportado
```

Também aceita stdin:

```bash
adb exec-out run-as org.example.fieldmonitoring \
  cat files/diagnostics/diagnostics-2026-08-25-000.jsonl \
  | npm run diagnostics:analyze -- -
```

`run-as` normalmente só funciona com APK debuggable. Para builds preview/release,
use o botão que chama `diagnostics.export()`.

O relatório apresenta:

- período, schemas, linhas inválidas e registros duplicados;
- sessões, encerramentos não limpos, gaps de sequência e heartbeat;
- capturas iniciadas, concluídas, falhas, timeouts e último sucesso;
- p50/p95/máximo de duração e drift do agendamento;
- tendência do espaço disponível;
- eventos mais frequentes e erros agrupados por evento, estágio, código e mensagem.

Uma última linha inválida pode indicar encerramento durante a escrita. Ela é
reportada, mas não impede a análise das linhas anteriores. O comando retorna código
1 apenas quando não encontra nenhum registro válido; erros de argumentos/entrada
retornam código 2.

## Roteiro de operação por sete dias

1. Inicialize o logger cedo e inclua versão, build e commit em `initialize()`.
2. Chame `markMonitoringActive()` imediatamente antes de iniciar a rodada; grave
   os eventos de câmera por estágio e inicie um heartbeat de 60 segundos.
3. Mantenha o aparelho ligado, o app em primeiro plano e registre mudanças de
   `AppState`; `keep-awake` sozinho não reinicia um processo encerrado.
4. Consulte `getStatus()` diariamente para verificar quantidade de datas, última
   escrita, espaço livre e falhas do próprio logger.
5. Chame `markMonitoringStopped()` em toda parada controlada. Exporte ao fim do
   teste e, idealmente, uma vez por dia. Não limpe dados nem
   reinstale o app antes da última exportação.
6. Rode o analisador sobre a pasta exportada e preserve a saída junto com o build
   exato usado no teste.
