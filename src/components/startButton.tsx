import React from 'react';
import { Text, TouchableOpacity, StyleSheet, useWindowDimensions, Alert, Linking } from 'react-native';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { Camera, PermissionStatus } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { RootStackList } from '../types';
import { FontStyleSemiBold, COLORS, SPACING } from '../theme';
import { useAppContext } from '../context/AppContext';
import { useCameraContext } from '../context/CameraContext';

// This component renders the "Iniciar" button on the menu screen
const StartButton = () => {
  const {
    hasCameraPermission,
    hasMediaPermission,
    requestCameraPermission,
  } = useCameraContext();
  const { startMonitoring, time } = useAppContext();
  
  const navigation = useNavigation<NavigationProp<RootStackList>>();

  const navigateToMonitoring = async () => {
    try {
      await startMonitoring();
      navigation.navigate('Monitoring');
    } catch (error: unknown) {
      console.error('Erro ao iniciar monitoramento:', error);
      Alert.alert(
        'Não foi possível iniciar',
        'Não foi possível salvar o estado do monitoramento. Tente novamente.',
      );
    }
  };

  const handleStart = async () => {
    if (
      hasCameraPermission === PermissionStatus.GRANTED &&
      hasMediaPermission === true
    ) {
      await navigateToMonitoring();
      return;
    }

    if (hasCameraPermission === PermissionStatus.DENIED) {
      showSettingsAlert();
      return;
    }

    await requestCameraPermission();

    const [{ status }, mediaPermission] = await Promise.all([
      Camera.getCameraPermissionsAsync(),
      MediaLibrary.getPermissionsAsync(),
    ]);

    if (
      status === PermissionStatus.GRANTED &&
      mediaPermission.granted
    ) {
      await navigateToMonitoring();
    } else if (
      status === PermissionStatus.DENIED ||
      !mediaPermission.granted
    ) {
      showSettingsAlert();
    }
  };

  const showSettingsAlert = () => {
    Alert.alert(
      "Permissão Necessária",
      "O acesso à câmera ou à galeria foi negado. Para iniciar o monitoramento, permita ambos nas configurações do celular.",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Abrir Configurações", 
          onPress: () => Linking.openSettings() 
        }
      ]
    );
  };

  const { width } = useWindowDimensions();
  const buttonSize = width * 0.7;

  return(
    <>
      <TouchableOpacity
        style={[styles.confirmBtn, { width: buttonSize }]}
        onPress={handleStart}
        disabled={time.value <= 0}
      >
        <Text style={[styles.btnText, FontStyleSemiBold]}>Iniciar</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    width: '100%',
    alignItems: 'center', 
    justifyContent: 'space-around', 
    backgroundColor: COLORS.background,
  },
  confirmBtn: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: 99,
    backgroundColor: COLORS.primary,
  },
  btnText: { 
    color: COLORS.white, 
    fontSize: SPACING.xxl, 
    textAlign: 'center' 
  }
});

export default StartButton;
