import React, { useState } from 'react';
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  COLORS,
  FONT_SIZES,
  FontStyleMedium,
  SPACING,
} from '../theme';
import { diagnostics } from '../services/diagnostics';

export default function DiagnosticsButton() {
  const [isExporting, setIsExporting] = useState(false);

  const exportDiagnostics = async () => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      const result = await diagnostics.export();

      if (!result) {
        return;
      }

      const sizeMb = (result.totalBytes / (1024 * 1024)).toFixed(2);

      Alert.alert(
        'Diagnóstico exportado',
        `${result.fileCount} arquivo(s) de log (${sizeMb} MB) foram copiados para a pasta escolhida.`,
      );
    } catch (error: unknown) {
      console.error('Erro ao exportar diagnóstico:', error);
      await diagnostics.error(
        'diagnostics_export_ui_failed',
        error,
      );
      Alert.alert(
        'Falha ao exportar',
        'Não foi possível copiar os arquivos de diagnóstico.',
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <View style={[styles.header, { paddingTop: StatusBar.currentHeight }]}>
      <TouchableOpacity
        style={styles.button}
        disabled={isExporting}
        onPress={() => {
          void exportDiagnostics();
        }}
      >
        <Text style={[styles.text, FontStyleMedium]}>
          {isExporting ? 'Exportando...' : 'Diagnóstico'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  button: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopRightRadius: 99,
    borderBottomRightRadius: 99,
    backgroundColor: COLORS.headerBackground,
  },
  text: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    textAlign: 'center',
  },
});
