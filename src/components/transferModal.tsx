import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FontStyleRegular, FontStyleMedium } from '../theme/fonts';
import { COLORS, FONT_SIZES, SPACING } from '../theme';

type ModalStatus = 'loading' | 'success' | 'error';

interface TransferModalProps {
  visible: boolean;
  status: ModalStatus;
  title: string;
  message: string;
  progress?: number;
  buttonText?: string;
  onButtonPress?: () => void;
}

export const TransferModal = ({
  visible,
  status,
  title,
  message,
  progress,
  buttonText,
  onButtonPress,
}: TransferModalProps) => {
  const getMessageStyle = () => {
    if (status === 'error') {
      return styles.errorText;
    } else {
      return styles.text;
    }
  };

  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={[styles.title, FontStyleRegular]}>{title}</Text>

          {(status === 'loading' &&
            <>
              <ActivityIndicator size="large" color={COLORS.textSecondary} style={{ paddingVertical: SPACING.md }} />
              {progress !== 0 && 
                <Text style={[styles.progressText, FontStyleMedium]}>{progress}%</Text>
              }
              <TouchableOpacity style={styles.button} disabled>
                <Text style={[styles.buttonText, FontStyleRegular]}>{buttonText}</Text>
              </TouchableOpacity>
            </>
          )}

          {(status === 'success' || status === 'error') && buttonText && onButtonPress && (
            <>
              <Text style={[getMessageStyle(), FontStyleMedium]}>{message}</Text>
              <TouchableOpacity style={styles.button} onPress={onButtonPress}>
                <Text style={[styles.buttonText, FontStyleRegular]}>{buttonText}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    height: 300,
    backgroundColor: COLORS.background,
    borderRadius: 24,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    textAlign: 'center',
    fontSize: FONT_SIZES.xl,
    color: COLORS.textPrimary,
  },
  progressText: {
    fontSize: FONT_SIZES.xxl,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.md,
  },
  loadingMessage: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingBottom: SPACING.lg,
  },
  text: {
    textAlign: 'center',
    fontSize: FONT_SIZES.xxl,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.md,
  },
  errorText: {
    textAlign: 'center',
    fontSize: FONT_SIZES.xl,
    color: COLORS.error,
    paddingVertical: SPACING.md,
  },
  button: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.headerBackground,
    borderRadius: 99,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
    marginTop: SPACING.lg,
  },
  buttonText: {
    textAlign: 'center',
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
  },
});

export default TransferModal;