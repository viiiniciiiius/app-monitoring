import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, SafeAreaView, StatusBar } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { renderImage } from '../components/renderImages';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { FontStyleRegular, FontStyleMedium, COLORS, FONT_SIZES, SPACING } from '../theme';
import { useTransferImage } from '../hooks/useTransferImage';
import { TransferModal } from '../components/transferModal';
import { SelectedAsset, UploadProgress, ImagePayload } from '../types';
import { useKeepAwake } from 'expo-keep-awake';
import { useAppContext } from '../context/AppContext';
import { InputModal } from '../components/inputModal';

export const TransferScreen = () => {

  const { setHostName } = useAppContext();
  const [selectedImages, setSelectedImages] = useState<SelectedAsset[]>([]);
  const navigation = useNavigation();
  
  const [modalState, setModalState] = useState({
    visible: false,
    status: 'loading' as 'loading' | 'success' | 'error',
    title: '',
    message: '',
    progress: 0,
  });
  useKeepAwake();

  const [modalVisible, setModalVisible] = useState(false);

  const handlePress = () => {
    setModalVisible(true);
  };

  const handleSaveHost = (newHost: string) => {
    console.log("Salvando:", newHost);
    setHostName(newHost);
    setModalVisible(false);
  };

  const { mutate, isPending, reset } = useTransferImage({
    onMutate: (variables) => {
      const total = variables.images.length;
      setModalState({
        visible: true,
        status: 'loading',
        title: total === 1 ? 'Transferindo 1 Foto' : `Transferindo ${total} Fotos`,
        message: '',
        progress: 0,
      });
    },
    onSuccess: (data) => {
      setModalState(prev => ({
        ...prev,
        status: 'success',
        title: 'Transferência Concluída',
        message: `${data.totalImages} fotos enviadas!`,
      }));
    },
    onError: (error) => {
      setModalState(prev => ({
        ...prev,
        status: 'error',
        title: 'Ocorreu um erro',
        message: error.message || 'Falha na transferência.',
      }));
    },
  });

  const handleProgressUpdate = (progress: UploadProgress) => {
    setModalState(prev => ({
      ...prev,
      status: 'loading', 
      progress: progress.percentage,
    }));
  };

  const pickImages = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/jpeg',
        multiple: true,
        copyToCacheDirectory: true,
      });

      let newAssets: SelectedAsset[] = [];
      if (result.assets) {
        newAssets = result.assets.map(asset => ({
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType,
          assetId: asset.uri,
        }));
      }

      setSelectedImages(previousImages => {
        const existingUris = new Set(previousImages.map(img => img.uri));
        const uniqueNewAssets = newAssets.filter(asset => !existingUris.has(asset.uri));
        return [...previousImages, ...uniqueNewAssets];
      });

    } catch (err) {
      console.warn(err);
    }
  };

  const handleTransfer = () => {
    if (selectedImages.length === 0) return;

    const imagesData: ImagePayload[] = selectedImages.map(img => ({
      uri: img.uri,
      fileName: img.fileName || `image-${Date.now()}.jpg`,
      type: img.mimeType || 'image/jpeg',
    }));

    mutate({
      images: imagesData,
      onProgress: handleProgressUpdate,
    });
  };

  const handleCloseModal = () => {
    setModalState(prev => ({ ...prev, visible: false }));
    if (modalState.status === 'success') {
      setSelectedImages([]);
      reset();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.fixed, { paddingTop: StatusBar.currentHeight }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.btnBack}>
          <Ionicons name="close" size={36} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePress} style={styles.btnBack}>
          <Ionicons name="settings" size={36} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>
      <View style={[styles.header, { paddingTop: (StatusBar.currentHeight || 0) + 72 }]}>
        <Text style={[styles.title, FontStyleMedium]}>Selecione as Fotos para Transferir</Text>
        <TouchableOpacity style={styles.button} onPress={pickImages}>
          <Text style={[styles.buttonText, FontStyleMedium]}>Abrir Galeria</Text>
        </TouchableOpacity>

        {selectedImages.length > 0 && (
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[styles.button, styles.transferButton]}
              onPress={handleTransfer}
              disabled={isPending}
            >
              <Text style={[styles.buttonText, {color: COLORS.background}, FontStyleMedium]}>
                {isPending ? 'Transferindo...' : `Transferir ${selectedImages.length} Foto(s)`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.clearButton]}
              onPress={() => setSelectedImages([])}
              accessibilityLabel="Limpar seleção"
            >
              <Ionicons name="trash" size={24} color={COLORS.background} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {selectedImages.length > 0 ? (
        <FlatList
          data={selectedImages}
          renderItem={renderImage}
          keyExtractor={(item) => item.assetId || item.uri}
          numColumns={3}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
        />
      ) : (
        <View style={styles.placeholderContainer}>
          <Text style={[styles.placeholderText, FontStyleRegular]}>Nenhuma imagem selecionada.</Text>
        </View>
      )}

      <TransferModal
        visible={modalState.visible}
        status={modalState.status}
        title={modalState.title}
        message={modalState.message}
        progress={modalState.progress}
        buttonText={modalState.status !== 'loading' ? 'Ok' : 'Aguarde'}
        onButtonPress={handleCloseModal}
      />

      <InputModal
        visible={modalVisible}
        title="Função de desenvolvedor"
        message={'Digite o ip do computador ou o usuário com ".local" como sufixo:'}
        placeholder="192.168.xxx.xx ou usuario.local"
        onClose={() => setModalVisible(false)}
        onSave={handleSaveHost}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  fixed: {
    position: 'absolute', 
    left: 0,
    right: 0,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: SPACING.sm,
    zIndex: 2,
  },
  btnBack: {
    padding: SPACING.sm,
    borderRadius: 8,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
    backgroundColor: COLORS.headerBackground,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 99,
    marginBottom: SPACING.lg,
    width: '100%',
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    alignItems: 'center',
  },
  transferButton: {
    flex: 1,
    width: undefined,
    backgroundColor: COLORS.success,
  },
  clearButton: {
    backgroundColor: COLORS.warning,
    width: 54,
    borderRadius: 99,
  },
  buttonText: {
    color: 'white',
    fontSize: FONT_SIZES.lg,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  list: {
    padding: SPACING.md,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
  },
});

export default TransferScreen;