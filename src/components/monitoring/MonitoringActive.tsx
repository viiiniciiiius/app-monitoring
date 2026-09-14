import React from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { CameraView } from 'expo-camera';

import type { MonitoringController } from '../../hooks/useMonitoringController';
import { FontStyleMedium, FontStyleRegular } from '../../theme';
import { monitoringStyles as styles } from './styles';

interface MonitoringActiveProps {
  controller: MonitoringController;
}

export function MonitoringActive({
  controller,
}: MonitoringActiveProps) {
  const {
    cameraGeneration,
    cameraRef,
    confirmStopMonitoring,
    consecutiveFailures,
    errorMessage,
    handleCameraMountError,
    handleCameraReady,
    isCameraMounted,
    lastSuccessLabel,
    logs,
    statusMessage,
  } = controller;

  return (
    <View style={styles.container}>
      {isCameraMounted && (
        <View style={styles.cameraContainer}>
          <CameraView
            key={`camera-${cameraGeneration}`}
            ref={cameraRef}
            style={styles.camera}
            facing="back"
            onCameraReady={handleCameraReady}
            onMountError={handleCameraMountError}
          />
        </View>
      )}

      <Text style={[styles.textSecondary, FontStyleRegular]}>
        Posicione o celular para captura
      </Text>

      <Text style={[styles.title, FontStyleMedium]}>
        Monitoramento ativo
      </Text>

      <Text style={styles.statusText}>{statusMessage}</Text>

      <Text style={styles.detailText}>
        Última foto: {lastSuccessLabel ?? 'nenhuma nesta sessão'}
      </Text>

      {consecutiveFailures > 0 && (
        <Text style={styles.detailText}>
          Falhas consecutivas: {consecutiveFailures}
        </Text>
      )}

      {errorMessage && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}

      <FlatList
        data={logs}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => (
          <View style={styles.logItem}>
            <Text
              style={
                item.status === 'error'
                  ? styles.errorLogText
                  : styles.logText
              }
            >
              {item.message ?? 'Evento'} às {item.time}
            </Text>
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.actionButton, styles.stopButton]}
        onPress={confirmStopMonitoring}
      >
        <Text style={styles.actionButtonText}>
          Parar monitoramento
        </Text>
      </TouchableOpacity>
    </View>
  );
}
