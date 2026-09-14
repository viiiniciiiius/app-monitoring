import axios from 'axios';
import { ImagePayload } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const getHostName = async () => {
  const envHostName = process.env.EXPO_PUBLIC_HOST_NAME;
  const defaultIp = '0.0.0.0';

  try {
    const cacheHostName = await AsyncStorage.getItem('@field-monitoring:info.hostname');
    
    if (cacheHostName) {
      try {
        const parsed = JSON.parse(cacheHostName);
        return parsed.value;
      } catch (e) {
        return cacheHostName;
      }
    }
  } catch (e) {
    console.error("Error loading cachehostname:", e);
  }
  return envHostName || defaultIp;
};

// Function responsible for sending a batch of images to the server via HTTP POST
export const transferImagesBatch = async ({ images }: { images: ImagePayload[] }) => {

  const hostName = await getHostName();
  const serverUrl = `http://${hostName}:8080/upload`;

  // Validation: ensures there are images to send
  if (!images || images.length === 0) {
    throw new Error('Nenhuma imagem restante.');
  }


  // Builds the FormData object with the images for multipart/form-data upload
  const formData = new FormData();
  images.forEach((image) => {
    formData.append('imagem', {
      uri: image.uri,
      name: image.fileName,
      type: image.type,
    } as any);
  });

  try {
  // Sends the POST request with the images to the server
    const response = await axios.post(serverUrl, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

  // Handles possible HTTP status errors
    if (!response.status) {
      let errorMessage: string;

      switch (response.status) {
        case 404:
          errorMessage = 'Serviço não encontrado.';
          break;
        case 500:
          errorMessage = 'Erro interno no servidor.';
          break;
        case 400:
          errorMessage = 'Os dados são inválidos.';
          break;
        default:
          errorMessage = `Erro inesperado (${response.status}).`;
          break;
      }

      throw new Error(errorMessage);
    }

    return response.data;

  } catch (error: any) {
    // Catches network or connection errors
    if (error instanceof TypeError) {
      throw new Error('No connection to the server.');
    }

    // Propagates other errors
    throw error;
  }
};
