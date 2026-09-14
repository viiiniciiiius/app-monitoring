import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { MonitoringController } from '../../hooks/useMonitoringController';
import { monitoringStyles as styles } from './styles';

interface MonitoringPermissionsProps {
  controller: MonitoringController;
}

export function MonitoringPermissions({
  controller,
}: MonitoringPermissionsProps) {
  const {
    confirmStopMonitoring,
    isLoadingPermissions,
    requestCameraPermission,
  } = controller;

  return (
    <View style={styles.container}>
      <Text style={styles.logText}>
        {isLoadingPermissions
          ? 'Verificando permissões...'
          : 'Permissões da câmera e da galeria são necessárias.'}
      </Text>

      {!isLoadingPermissions && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            void requestCameraPermission();
          }}
        >
          <Text style={styles.actionButtonText}>
            Solicitar permissões
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.actionButton, styles.stopButton]}
        onPress={confirmStopMonitoring}
      >
        <Text style={styles.actionButtonText}>Parar</Text>
      </TouchableOpacity>
    </View>
  );
}
