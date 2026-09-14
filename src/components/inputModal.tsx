import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import { FontStyleRegular, FontStyleMedium } from '../theme/fonts';
import { COLORS, FONT_SIZES, SPACING } from '../theme';

interface InputModalProps {
  visible: boolean;
  title: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  onClose: () => void;
  onSave: (text: string) => void;
}

export const InputModal = ({
  visible,
  title,
  message,
  placeholder = '',
  initialValue = '',
  onClose,
  onSave,
}: InputModalProps) => {
  const [text, setText] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setText(initialValue);
    }
  }, [visible, initialValue]);

  const handleSave = () => {
    if (text.trim().length > 0) {
      onSave(text);
      setText('');
    }
  };

  const isValid = text.trim().length > 0;

  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.modalOverlay} 
        activeOpacity={1} 
        onPressOut={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalContainer}>
              <View style={styles.contentContainer}>
                <Text style={[styles.title, FontStyleRegular]}>{title}</Text>
                
                <Text style={[styles.message, FontStyleMedium]}>{message}</Text>

                <TextInput
                  style={[styles.input, FontStyleRegular]}
                  placeholder={placeholder}
                  placeholderTextColor={COLORS.textSecondary}
                  value={text}
                  onChangeText={setText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View style={styles.buttonRow}>
                  <TouchableOpacity 
                    style={[styles.button, styles.cancelButton]} 
                    onPress={onClose}
                  >
                    <Text style={[styles.buttonText, styles.cancelButtonText, FontStyleRegular]}>
                      Cancelar
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.button, styles.saveButton, !isValid && styles.disabledButton]} 
                    onPress={handleSave}
                    disabled={!isValid}
                  >
                    <Text style={[styles.buttonText, FontStyleRegular]}>
                      Salvar
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </TouchableOpacity>
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
  keyboardView: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    width: '90%',
    backgroundColor: COLORS.background,
    borderRadius: 24,
    padding: SPACING.xl,
  },
  contentContainer: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    fontSize: FONT_SIZES.xl,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  message: {
    textAlign: 'center',
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  input: {
    width: '100%',
    backgroundColor: COLORS.headerBackground,
    borderRadius: 12,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xl,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: SPACING.md,
  },
  button: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 99,
    paddingVertical: SPACING.md,
  },
  saveButton: {
    backgroundColor: COLORS.headerBackground,
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.textSecondary,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textPrimary,
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
  },
});

export default InputModal;