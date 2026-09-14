#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROGRAM_NAME="$(basename "$0")"
readonly DEFAULT_PACKAGE="org.example.fieldmonitoring"
readonly DEFAULT_DURATION="7d"
readonly DEFAULT_SNAPSHOT_INTERVAL="5m"
readonly DEFAULT_COMMAND_TIMEOUT="45s"
readonly LOGCAT_SEGMENT_SECONDS=3600
readonly LOGCAT_RETRY_SECONDS=30

PACKAGE_NAME="$DEFAULT_PACKAGE"
DURATION_VALUE="$DEFAULT_DURATION"
SNAPSHOT_INTERVAL_VALUE="$DEFAULT_SNAPSHOT_INTERVAL"
COMMAND_TIMEOUT_VALUE="$DEFAULT_COMMAND_TIMEOUT"
REQUESTED_SERIAL=""
REQUESTED_OUTPUT_DIR=""

OUTPUT_DIR=""
EVENTS_FILE=""
ADB_SERIAL=""
LOGCAT_PID=""
LOGCAT_FILE=""
ACTIVE_COMMAND_PID=""
SIGNAL_NAME=""
CLEANUP_DONE=0
LOGCAT_SEQUENCE=0
SNAPSHOT_SEQUENCE=0

usage() {
  cat <<'EOF'
Uso:
  collect-android-diagnostics.sh [opções]

Coleta diagnósticos de um aparelho Android físico durante um teste prolongado.
Por padrão, executa por 7 dias, cria um diretório novo no diretório atual,
segmenta o logcat a cada hora e tira snapshots a cada 5 minutos.

Opções:
  --duration VALOR           Duração total. Aceita s, m, h ou d (padrão: 7d).
                             Exemplos: 90s, 30m, 12h, 7d.
  --snapshot-interval VALOR  Intervalo dos snapshots (padrão: 5m).
  --command-timeout VALOR    Timeout por comando adb/dumpsys (padrão: 45s).
  --output DIRETÓRIO         Diretório novo para a coleta. O script recusa um
                             caminho que já exista para não sobrescrever dados.
  --serial SERIAL            Serial exibido por "adb devices -l". Obrigatório
                             quando houver mais de um aparelho conectado.
  --package PACOTE           Application ID monitorado
                             (padrão: org.example.fieldmonitoring).
  -h, --help                 Mostra esta ajuda e encerra.

Conteúdo gerado:
  logcat/                    Segmentos de até uma hora de todos os buffers.
  snapshots/                PID, meminfo, bateria, temperatura, câmera,
                            device idle, armazenamento e histórico de saída.
  events.tsv                Linha do tempo do próprio coletor.
  session.txt               Metadados e parâmetros da sessão.

Observações:
  - O buffer global do logcat NÃO é limpo. Cada segmento usa "-T 1", portanto
    pode repetir a última linha do segmento anterior para evitar lacunas.
  - O aparelho deve permanecer com depuração USB autorizada. Desconexões e
    falhas de comandos ficam registradas; o coletor tenta retomar o logcat.
  - Requer Bash, adb e o comando GNU timeout no computador coletor.
EOF
}

die() {
  printf 'Erro: %s\n' "$*" >&2
  exit 1
}

require_option_value() {
  local option_name="$1"
  local option_value="${2-}"

  if [[ -z "$option_value" || "$option_value" == --* ]]; then
    die "a opção $option_name requer um valor"
  fi
}

parse_duration_seconds() {
  local raw_value="$1"
  local amount
  local suffix
  local multiplier

  if [[ ! "$raw_value" =~ ^([1-9][0-9]*)([smhd]?)$ ]]; then
    return 1
  fi

  amount="${BASH_REMATCH[1]}"
  suffix="${BASH_REMATCH[2]}"

  case "$suffix" in
    ""|s) multiplier=1 ;;
    m) multiplier=60 ;;
    h) multiplier=3600 ;;
    d) multiplier=86400 ;;
    *) return 1 ;;
  esac

  if (( amount > 2147483647 / multiplier )); then
    return 1
  fi

  printf '%s\n' "$((amount * multiplier))"
}

format_epoch_utc() {
  local epoch="$1"

  if date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null; then
    return 0
  fi

  date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ'
}

host_timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

file_timestamp() {
  date -u '+%Y%m%dT%H%M%SZ'
}

log_event() {
  local event_name="$1"
  local detail="${2-}"

  if [[ -n "$EVENTS_FILE" ]]; then
    printf '%s\t%s\t%s\n' "$(host_timestamp)" "$event_name" "$detail" >> "$EVENTS_FILE" 2>/dev/null || true
  fi
}

terminate_pid() {
  local target_pid="$1"
  local attempt

  if [[ -z "$target_pid" || ! "$target_pid" =~ ^[0-9]+$ ]]; then
    return 0
  fi

  if kill -0 "$target_pid" 2>/dev/null; then
    kill -TERM "$target_pid" 2>/dev/null || true

    for attempt in 1 2 3 4 5; do
      if ! kill -0 "$target_pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done

    if kill -0 "$target_pid" 2>/dev/null; then
      kill -KILL "$target_pid" 2>/dev/null || true
    fi
  fi

  wait "$target_pid" 2>/dev/null || true
}

stop_active_command() {
  local command_pid="$ACTIVE_COMMAND_PID"
  ACTIVE_COMMAND_PID=""
  terminate_pid "$command_pid"
}

stop_logcat() {
  local reason="${1:-stop}"
  local logcat_pid="$LOGCAT_PID"
  local logcat_file="$LOGCAT_FILE"
  local exit_status=0

  LOGCAT_PID=""
  LOGCAT_FILE=""

  if [[ -z "$logcat_pid" ]]; then
    return 0
  fi

  if kill -0 "$logcat_pid" 2>/dev/null; then
    terminate_pid "$logcat_pid"
    exit_status=143
  else
    if wait "$logcat_pid" 2>/dev/null; then
      exit_status=0
    else
      exit_status=$?
    fi
  fi

  log_event "logcat_stopped" "reason=$reason status=$exit_status file=$logcat_file"
}

cleanup() {
  local exit_status=$?

  if (( CLEANUP_DONE == 1 )); then
    return
  fi
  CLEANUP_DONE=1

  trap - EXIT INT TERM HUP
  stop_active_command
  stop_logcat "collector_exit"

  if [[ -n "$EVENTS_FILE" ]]; then
    if [[ -n "$SIGNAL_NAME" ]]; then
      log_event "collector_interrupted" "signal=$SIGNAL_NAME status=$exit_status"
    else
      log_event "collector_exit" "status=$exit_status"
    fi
  fi

  exit "$exit_status"
}

run_with_timeout() {
  local output_file="$1"
  shift
  local command_status=0

  timeout --signal=TERM --kill-after=5s "${COMMAND_TIMEOUT_SECONDS}s" "$@" > "$output_file" 2>&1 &
  ACTIVE_COMMAND_PID=$!

  if wait "$ACTIVE_COMMAND_PID"; then
    command_status=0
  else
    command_status=$?
  fi

  ACTIVE_COMMAND_PID=""
  return "$command_status"
}

capture_command() {
  local status_file="$1"
  local label="$2"
  local output_file="$3"
  shift 3
  local command_status=0

  run_with_timeout "$output_file" "$@" || command_status=$?
  printf '%s\t%s\t%s\n' "$label" "$command_status" "$(basename "$output_file")" >> "$status_file"

  if (( command_status != 0 )); then
    log_event "snapshot_command_failed" "label=$label status=$command_status output=$output_file"
  fi
}

take_snapshot() {
  local snapshot_kind="$1"
  local snapshot_stamp
  local snapshot_dir
  local status_file

  SNAPSHOT_SEQUENCE=$((SNAPSHOT_SEQUENCE + 1))
  snapshot_stamp="$(file_timestamp)"
  snapshot_dir="$(printf '%s/snapshots/%06d-%s-%s' "$OUTPUT_DIR" "$SNAPSHOT_SEQUENCE" "$snapshot_stamp" "$snapshot_kind")"
  mkdir -- "$snapshot_dir"

  status_file="$snapshot_dir/status.tsv"
  printf 'command\texit_status\tfile\n' > "$status_file"

  {
    printf 'snapshot_kind=%s\n' "$snapshot_kind"
    printf 'snapshot_sequence=%s\n' "$SNAPSHOT_SEQUENCE"
    printf 'host_time_utc=%s\n' "$(host_timestamp)"
    printf 'host_epoch=%s\n' "$(date '+%s')"
    printf 'serial=%s\n' "$ADB_SERIAL"
    printf 'package=%s\n' "$PACKAGE_NAME"
  } > "$snapshot_dir/metadata.txt"

  log_event "snapshot_started" "sequence=$SNAPSHOT_SEQUENCE kind=$snapshot_kind directory=$snapshot_dir"

  capture_command "$status_file" "device-date" "$snapshot_dir/device-date.txt" \
    "${ADB_COMMAND[@]}" shell date
  capture_command "$status_file" "uptime" "$snapshot_dir/uptime.txt" \
    "${ADB_COMMAND[@]}" shell uptime
  capture_command "$status_file" "pid" "$snapshot_dir/pid.txt" \
    "${ADB_COMMAND[@]}" shell pidof "$PACKAGE_NAME"
  capture_command "$status_file" "meminfo" "$snapshot_dir/meminfo.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys meminfo "$PACKAGE_NAME"
  capture_command "$status_file" "battery" "$snapshot_dir/battery.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys battery
  capture_command "$status_file" "thermalservice" "$snapshot_dir/thermalservice.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys thermalservice
  capture_command "$status_file" "media-camera" "$snapshot_dir/media-camera.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys media.camera
  capture_command "$status_file" "deviceidle" "$snapshot_dir/deviceidle.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys deviceidle
  capture_command "$status_file" "device-df" "$snapshot_dir/device-df.txt" \
    "${ADB_COMMAND[@]}" shell df -h
  capture_command "$status_file" "exit-info" "$snapshot_dir/activity-exit-info.txt" \
    "${ADB_COMMAND[@]}" shell dumpsys activity exit-info "$PACKAGE_NAME"
  capture_command "$status_file" "host-df" "$snapshot_dir/host-df.txt" \
    df -h "$OUTPUT_DIR"

  log_event "snapshot_finished" "sequence=$SNAPSHOT_SEQUENCE kind=$snapshot_kind directory=$snapshot_dir"
}

start_logcat_segment() {
  local segment_stamp

  if [[ -n "$LOGCAT_PID" ]]; then
    return 0
  fi

  if ! "${ADB_COMMAND[@]}" get-state >/dev/null 2>&1; then
    log_event "logcat_start_deferred" "device_not_available serial=$ADB_SERIAL"
    return 1
  fi

  LOGCAT_SEQUENCE=$((LOGCAT_SEQUENCE + 1))
  segment_stamp="$(file_timestamp)"
  LOGCAT_FILE="$(printf '%s/logcat/logcat-%06d-%s.log' "$OUTPUT_DIR" "$LOGCAT_SEQUENCE" "$segment_stamp")"

  # Não usar `adb logcat -c`: o buffer global do aparelho deve permanecer intacto.
  # `-T 1` inclui uma linha anterior e então acompanha apenas mensagens novas.
  "${ADB_COMMAND[@]}" logcat -b all -v threadtime -T 1 > "$LOGCAT_FILE" 2>&1 &
  LOGCAT_PID=$!
  log_event "logcat_started" "pid=$LOGCAT_PID file=$LOGCAT_FILE"
}

while (( $# > 0 )); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --duration)
      require_option_value "$1" "${2-}"
      DURATION_VALUE="$2"
      shift 2
      ;;
    --duration=*)
      DURATION_VALUE="${1#*=}"
      shift
      ;;
    --snapshot-interval)
      require_option_value "$1" "${2-}"
      SNAPSHOT_INTERVAL_VALUE="$2"
      shift 2
      ;;
    --snapshot-interval=*)
      SNAPSHOT_INTERVAL_VALUE="${1#*=}"
      shift
      ;;
    --command-timeout)
      require_option_value "$1" "${2-}"
      COMMAND_TIMEOUT_VALUE="$2"
      shift 2
      ;;
    --command-timeout=*)
      COMMAND_TIMEOUT_VALUE="${1#*=}"
      shift
      ;;
    --output)
      require_option_value "$1" "${2-}"
      REQUESTED_OUTPUT_DIR="$2"
      shift 2
      ;;
    --output=*)
      REQUESTED_OUTPUT_DIR="${1#*=}"
      shift
      ;;
    --serial)
      require_option_value "$1" "${2-}"
      REQUESTED_SERIAL="$2"
      shift 2
      ;;
    --serial=*)
      REQUESTED_SERIAL="${1#*=}"
      shift
      ;;
    --package)
      require_option_value "$1" "${2-}"
      PACKAGE_NAME="$2"
      shift 2
      ;;
    --package=*)
      PACKAGE_NAME="${1#*=}"
      shift
      ;;
    --)
      shift
      if (( $# > 0 )); then
        die "argumentos posicionais não são aceitos: $*"
      fi
      ;;
    *)
      die "opção desconhecida: $1 (use --help)"
      ;;
  esac
done

DURATION_SECONDS="$(parse_duration_seconds "$DURATION_VALUE")" || \
  die "duração inválida: $DURATION_VALUE"
SNAPSHOT_INTERVAL_SECONDS="$(parse_duration_seconds "$SNAPSHOT_INTERVAL_VALUE")" || \
  die "intervalo de snapshot inválido: $SNAPSHOT_INTERVAL_VALUE"
COMMAND_TIMEOUT_SECONDS="$(parse_duration_seconds "$COMMAND_TIMEOUT_VALUE")" || \
  die "timeout de comando inválido: $COMMAND_TIMEOUT_VALUE"

if [[ ! "$PACKAGE_NAME" =~ ^[A-Za-z0-9_]+([.][A-Za-z0-9_]+)+$ ]]; then
  die "Application ID inválido: $PACKAGE_NAME"
fi

command -v adb >/dev/null 2>&1 || die "adb não foi encontrado no PATH"
command -v timeout >/dev/null 2>&1 || die "GNU timeout não foi encontrado no PATH"

adb start-server >/dev/null 2>&1 || die "não foi possível iniciar/conectar ao servidor adb"

ADB_DEVICES_OUTPUT="$(adb devices -l 2>&1)" || die "falha ao consultar adb devices"
CONNECTED_SERIALS=()

while read -r device_serial device_state _; do
  if [[ -n "$device_serial" && "$device_state" == "device" ]]; then
    CONNECTED_SERIALS+=("$device_serial")
  fi
done <<< "$ADB_DEVICES_OUTPUT"

if [[ -n "$REQUESTED_SERIAL" ]]; then
  ADB_SERIAL="$REQUESTED_SERIAL"
  if [[ "$(adb -s "$ADB_SERIAL" get-state 2>/dev/null || true)" != "device" ]]; then
    die "o dispositivo '$ADB_SERIAL' não está conectado e autorizado"
  fi
else
  case "${#CONNECTED_SERIALS[@]}" in
    0)
      printf '%s\n' "$ADB_DEVICES_OUTPUT" >&2
      die "nenhum dispositivo adb conectado e autorizado"
      ;;
    1)
      ADB_SERIAL="${CONNECTED_SERIALS[0]}"
      ;;
    *)
      printf '%s\n' "$ADB_DEVICES_OUTPUT" >&2
      die "mais de um dispositivo conectado; informe --serial"
      ;;
  esac
fi

ADB_COMMAND=(adb -s "$ADB_SERIAL")

QEMU_PROPERTY="$("${ADB_COMMAND[@]}" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r' || true)"
BOOT_QEMU_PROPERTY="$("${ADB_COMMAND[@]}" shell getprop ro.boot.qemu 2>/dev/null | tr -d '\r' || true)"

if [[ "$ADB_SERIAL" == emulator-* || "$QEMU_PROPERTY" == "1" || "$BOOT_QEMU_PROPERTY" == "1" ]]; then
  die "o alvo '$ADB_SERIAL' parece ser um emulador; use um aparelho físico para o teste"
fi

PACKAGE_PATH="$("${ADB_COMMAND[@]}" shell pm path "$PACKAGE_NAME" 2>&1 | tr -d '\r' || true)"
if [[ "$PACKAGE_PATH" != package:* ]]; then
  die "o pacote '$PACKAGE_NAME' não está instalado no dispositivo '$ADB_SERIAL'"
fi

if [[ -z "$REQUESTED_OUTPUT_DIR" ]]; then
  REQUESTED_OUTPUT_DIR="$PWD/android-diagnostics-$(file_timestamp)"
fi

if [[ -z "$REQUESTED_OUTPUT_DIR" || "$REQUESTED_OUTPUT_DIR" == "/" ]]; then
  die "diretório de saída inseguro: '$REQUESTED_OUTPUT_DIR'"
fi

if [[ "$REQUESTED_OUTPUT_DIR" == *$'\n'* || "$REQUESTED_OUTPUT_DIR" == *$'\r'* ]]; then
  die "o diretório de saída não pode conter quebras de linha"
fi

if [[ -e "$REQUESTED_OUTPUT_DIR" || -L "$REQUESTED_OUTPUT_DIR" ]]; then
  die "o diretório de saída já existe; escolha um caminho novo: $REQUESTED_OUTPUT_DIR"
fi

umask 077
mkdir -p -- "$REQUESTED_OUTPUT_DIR"
OUTPUT_DIR="$(cd -- "$REQUESTED_OUTPUT_DIR" && pwd -P)"
mkdir -- "$OUTPUT_DIR/logcat" "$OUTPUT_DIR/snapshots"

EVENTS_FILE="$OUTPUT_DIR/events.tsv"
printf 'host_time_utc\tevent\tdetail\n' > "$EVENTS_FILE"

trap cleanup EXIT
trap 'SIGNAL_NAME=HUP; exit 129' HUP
trap 'SIGNAL_NAME=INT; exit 130' INT
trap 'SIGNAL_NAME=TERM; exit 143' TERM

START_EPOCH="$(date '+%s')"
END_EPOCH="$((START_EPOCH + DURATION_SECONDS))"
DEVICE_MODEL="$("${ADB_COMMAND[@]}" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
ANDROID_VERSION="$("${ADB_COMMAND[@]}" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' || true)"
BUILD_FINGERPRINT="$("${ADB_COMMAND[@]}" shell getprop ro.build.fingerprint 2>/dev/null | tr -d '\r' || true)"

{
  printf 'collector=%s\n' "$PROGRAM_NAME"
  printf 'started_utc=%s\n' "$(format_epoch_utc "$START_EPOCH")"
  printf 'planned_end_utc=%s\n' "$(format_epoch_utc "$END_EPOCH")"
  printf 'duration_seconds=%s\n' "$DURATION_SECONDS"
  printf 'snapshot_interval_seconds=%s\n' "$SNAPSHOT_INTERVAL_SECONDS"
  printf 'command_timeout_seconds=%s\n' "$COMMAND_TIMEOUT_SECONDS"
  printf 'logcat_segment_seconds=%s\n' "$LOGCAT_SEGMENT_SECONDS"
  printf 'logcat_global_buffer_cleared=no\n'
  printf 'serial=%s\n' "$ADB_SERIAL"
  printf 'device_model=%s\n' "$DEVICE_MODEL"
  printf 'android_version=%s\n' "$ANDROID_VERSION"
  printf 'build_fingerprint=%s\n' "$BUILD_FINGERPRINT"
  printf 'package=%s\n' "$PACKAGE_NAME"
  printf 'package_path=%s\n' "$PACKAGE_PATH"
  printf 'output_directory=%s\n' "$OUTPUT_DIR"
} > "$OUTPUT_DIR/session.txt"

printf '%s\n' "$ADB_DEVICES_OUTPUT" > "$OUTPUT_DIR/adb-devices.txt"
adb version > "$OUTPUT_DIR/adb-version.txt" 2>&1 || true

log_event "collector_started" "serial=$ADB_SERIAL package=$PACKAGE_NAME duration_seconds=$DURATION_SECONDS output=$OUTPUT_DIR"
printf 'Coleta iniciada em %s\n' "$OUTPUT_DIR"
printf 'Dispositivo: %s (%s), Android %s\n' "$ADB_SERIAL" "$DEVICE_MODEL" "$ANDROID_VERSION"
printf 'Término planejado: %s\n' "$(format_epoch_utc "$END_EPOCH")"

NEXT_LOGCAT_ROTATION="$((START_EPOCH + LOGCAT_SEGMENT_SECONDS))"
NEXT_LOGCAT_RETRY="$START_EPOCH"

start_logcat_segment || NEXT_LOGCAT_RETRY="$((START_EPOCH + LOGCAT_RETRY_SECONDS))"
take_snapshot "initial"
NEXT_SNAPSHOT="$(( $(date '+%s') + SNAPSHOT_INTERVAL_SECONDS ))"

while true; do
  NOW_EPOCH="$(date '+%s')"

  if (( NOW_EPOCH >= END_EPOCH )); then
    break
  fi

  if [[ -n "$LOGCAT_PID" ]] && ! kill -0 "$LOGCAT_PID" 2>/dev/null; then
    stop_logcat "unexpected_exit"
    NEXT_LOGCAT_RETRY="$((NOW_EPOCH + LOGCAT_RETRY_SECONDS))"
  fi

  if (( NOW_EPOCH >= NEXT_LOGCAT_ROTATION )); then
    stop_logcat "hourly_rotation"
    while (( NEXT_LOGCAT_ROTATION <= NOW_EPOCH )); do
      NEXT_LOGCAT_ROTATION="$((NEXT_LOGCAT_ROTATION + LOGCAT_SEGMENT_SECONDS))"
    done
    NEXT_LOGCAT_RETRY="$NOW_EPOCH"
  fi

  if [[ -z "$LOGCAT_PID" ]] && (( NOW_EPOCH >= NEXT_LOGCAT_RETRY )); then
    if start_logcat_segment; then
      NEXT_LOGCAT_RETRY="$((NOW_EPOCH + LOGCAT_RETRY_SECONDS))"
    else
      NEXT_LOGCAT_RETRY="$((NOW_EPOCH + LOGCAT_RETRY_SECONDS))"
    fi
  fi

  if (( NOW_EPOCH >= NEXT_SNAPSHOT )); then
    take_snapshot "periodic"
    NOW_EPOCH="$(date '+%s')"
    NEXT_SNAPSHOT="$((NOW_EPOCH + SNAPSHOT_INTERVAL_SECONDS))"
  fi

  sleep 5
done

take_snapshot "final"
log_event "collection_completed" "duration_seconds=$DURATION_SECONDS snapshots=$SNAPSHOT_SEQUENCE logcat_segments=$LOGCAT_SEQUENCE"
printf 'Coleta concluída. Dados salvos em %s\n' "$OUTPUT_DIR"
