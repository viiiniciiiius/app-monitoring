import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, SafeAreaView, StatusBar } from 'react-native';
import { useAppContext } from '../context/AppContext';
import { FontStyleMedium, COLORS, FONT_SIZES, SPACING, FontStyleRegular } from '../theme';
import Entypo from '@expo/vector-icons/Entypo';
import NavigateTransfer from '../components/navigateTransfer';
import StartButton from '../components/startButton';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import DiagnosticsButton from '../components/diagnosticsButton';

export const MenuScreen = () => {
  const { time, setTime } = useAppContext();
  
  const [isFocused, setIsFocused] = useState(false);

  const totalMinutes = time.type === 'h' ? time.value * 60 : time.value;
  const photosByDay = totalMinutes > 0 ? Math.floor(1440 / totalMinutes) : 0;
  
  const sufixoTexto = time.type === 'h' 
    ? (time.value === 1 ? 'hora' : 'horas') 
    : (time.value === 1 ? 'minuto' : 'minutos');

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding" enabled>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <SafeAreaView style={[styles.container, { paddingVertical: StatusBar.currentHeight }]}>
          <DiagnosticsButton />
          <NavigateTransfer />
          <Image source={require('../../assets/field-monitoring-icon.svg')} style={styles.logo} contentFit='contain' />
          
          <View style={styles.subcontainer}>

            <Text style={[styles.text, FontStyleRegular]}>
              Determine o intervalo entre as fotos:
            </Text>
            
            <View style={styles.subcontainer}>
              <Text style={[styles.textSecondary, FontStyleMedium]}>Formato de tempo</Text>
              <View style={styles.inputRow}>
                <TouchableOpacity 
                  onPress={() => setTime({ ...time, type: 'h' })} 
                  disabled={time.type === 'h'}
                  style={[
                    styles.changeBtn, 
                    time.type === 'h' && { opacity: 0.5 }
                  ]}
                >
                  <Entypo name="chevron-thin-left" size={FONT_SIZES.xl} color={COLORS.white} />
                </TouchableOpacity>
                
                <TextInput
                  style={[styles.input, FontStyleMedium]}
                  value={time.type === 'h' ? 'Horas' : 'Minutos'} 
                  editable={false}
                />
                
                <TouchableOpacity 
                  onPress={() => setTime({ ...time, type: 'min' })} 
                  disabled={time.type === 'min'}
                  style={[
                    styles.changeBtn, 
                    time.type === 'min' && { opacity: 0.5 }
                  ]}
                >
                  <Entypo name="chevron-thin-right" size={FONT_SIZES.xl} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.subcontainer, { marginTop: SPACING.lg }]}>
              <Text style={[styles.textSecondary, FontStyleMedium]}>Fotografar a cada</Text>
              <View style={styles.inputRow}>
                <TouchableOpacity 
                  onPress={() => setTime({ ...time, value: Math.max(1, time.value - 1) })} 
                  disabled={time.value <= 1}
                  style={[styles.changeBtn, time.value <= 1 && { opacity: 0.5 }]}
                >
                  <Ionicons name="remove" size={FONT_SIZES.xl} color={COLORS.white} />
                </TouchableOpacity>

                <TextInput
                  style={[styles.input, FontStyleMedium]}
                  keyboardType="numeric"
                  value={isFocused ? (time.value === 0 ? '' : String(time.value)) : `${time.value} ${time.type === 'h' ? 'h' : 'min'}`}
                  onFocus={() => setIsFocused(true)}
                  onChangeText={t => {
                    const numericValue = t.replace(/[^0-9]/g, '');
                    
                    if (numericValue) {
                      // Pega o menor valor entre 120 e o número digitado
                      setTime({ ...time, value: Math.min(120, Number(numericValue)) });
                    } else {
                      setTime({ ...time, value: 0 });
                    }
                  }}
                  onBlur={() => {
                    setIsFocused(false);
                    if (!time.value || time.value <= 0) {
                      setTime({ ...time, value: 1 });
                    }
                  }}
                />

                <TouchableOpacity 
                  // Pega o menor valor entre 120 e a soma atual
                  onPress={() => setTime({ ...time, value: Math.min(120, time.value + 1) })} 
                  disabled={time.value >= 120} // Desativa se já for 120
                  style={[styles.changeBtn, time.value >= 120 && { opacity: 0.5 }]} // Fica transparente se desativado
                >
                  <Ionicons name="add" size={FONT_SIZES.xl} color={COLORS.white} />
                </TouchableOpacity>
              </View>
              
              <Text style={[styles.textSecondary, FontStyleRegular]}>
                {time.value} {sufixoTexto} são {photosByDay} fotos por dia 
              </Text>
            </View>

          </View>
          <StartButton />
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  ); 
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    width: '100%',
    alignItems: 'center', 
    justifyContent: 'space-around', 
    backgroundColor: COLORS.background,
  },
  subcontainer: { 
    flexDirection: 'column', 
    alignItems: 'center' 
  },
  logo: { 
    width: 92, 
    height: 92
  },
  text: { 
    fontSize: FONT_SIZES.xl, 
    paddingTop: SPACING.sm, 
    color: COLORS.textPrimary, 
    textAlign: 'center' 
  },
  textSecondary: { 
    fontSize: FONT_SIZES.lx, 
    paddingTop: SPACING.xl, 
    color: COLORS.textSecondary, 
    textAlign: 'center' 
  },
  inputRow: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  changeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 92,
    height: 64,
    borderRadius: 12,
    marginHorizontal: SPACING.md,
    backgroundColor: COLORS.primary,
  },
  input: {
    width: 120,
    height: 64,
    lineHeight: 58,
    textAlign: 'center',
    color: COLORS.textPrimary,
    borderWidth: 2,
    borderRadius: 12,
    fontSize: FONT_SIZES.lx,
    borderColor: COLORS.border,
  },
});

export default MenuScreen;
