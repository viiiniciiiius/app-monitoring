export interface SelectedAsset {
  uri: string;
  fileName: string;
  mimeType?: string;
  assetId?: string;
}

export interface ImagePayload {
  uri: string;
  fileName: string;
  type: string;
}

export interface TransferSuccessData {
  totalImages: number;
}

export interface UploadProgress {
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  imagesSent: number;
  totalImages: number;
}

export type TransferVariables = {
  images: ImagePayload[];
  onProgress: (progress: UploadProgress) => void;
};
