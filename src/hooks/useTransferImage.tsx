import { useMutation, UseMutationOptions } from '@tanstack/react-query';
import { transferImagesBatch } from '../api/transferImages';
import { TransferVariables, TransferSuccessData, UploadProgress } from '../types';

const batchSize = 50;

// Handles sending all images in batches, reporting progress after each batch
const transferAllImagesInBatches = async ({ images, onProgress }: TransferVariables): Promise<TransferSuccessData> => {
  const totalImages = images.length;
  if (totalImages === 0) {
    return { totalImages: 0};
  }

  // Calculate how many batches are needed
  const totalBatches = Math.ceil(totalImages / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    // Determine the start and end indices for the current batch
    const batchStart = i * batchSize;
    const batchEnd = batchStart + batchSize;
    const currentBatch = images.slice(batchStart, batchEnd);

    // Send the current batch of images
    await transferImagesBatch({
      images: currentBatch,
    });

    // Update progress after each batch is sent
    const imagesSentSoFar = Math.min(batchEnd, totalImages);
    const progress: UploadProgress = {
      percentage: Math.round(((i + 1) / totalBatches) * 100),
      currentBatch: i + 1,
      totalBatches: totalBatches,
      imagesSent: imagesSentSoFar,
      totalImages: totalImages,
    };
    onProgress(progress);
  }

  return {
    totalImages: totalImages,
  };
};

// Custom hook to handle the image transfer mutation using React Query
export const useTransferImage = (
  options?: UseMutationOptions<TransferSuccessData, Error, TransferVariables>
) => {
  return useMutation<TransferSuccessData, Error, TransferVariables>({
    mutationFn: transferAllImagesInBatches,
    ...options,
  });
};