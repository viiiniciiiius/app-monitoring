import { CaptureResult } from '../types';

export function sleep(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });
}

export function failureDescription(result: CaptureResult): string {
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

export function shouldRetry(result: CaptureResult): boolean {
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

export function shouldRemountCamera(
  result: CaptureResult,
): boolean {
  return (
    !result.ok &&
    (result.stage === 'take_picture' ||
      result.reason === 'camera_unavailable')
  );
}
