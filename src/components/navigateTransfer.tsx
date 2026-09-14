import React from "react";
import { FontStyleMedium } from '../theme/fonts';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { RootStackList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT_SIZES, SPACING } from "../theme";

// This component renders a button that navigates to the 'Transfer' screen when pressed
export const NavigateTransfer = () => {
  // Get navigation object typed with RootStackList for type safety
  const navigation = useNavigation<NavigationProp<RootStackList>>();

  // Function to handle navigation to the 'Transfer' screen
  const navigateTransfer = () => {
    navigation.navigate('Transfer');
  };

  return (
    // The header is positioned absolutely at the top right, with padding for the status bar
    <View style={[styles.header, { paddingTop: StatusBar.currentHeight }]}> 
      <TouchableOpacity
        style={styles.transferBtn}
        onPress={() => navigateTransfer()}
      >
        {/* Icon and label for the transfer button */}
        <Ionicons name="swap-horizontal" size={FONT_SIZES.lg} color={COLORS.textPrimary} />
        <Text style={[styles.transferText, FontStyleMedium]}>Transferir</Text>
      </TouchableOpacity>
    </View>
  );
};

// Styles for the header and transfer button
const styles = StyleSheet.create({
  header: {
    // Position the header absolutely at the top right corner
    position: 'absolute',
    top: 0,
    right: 0,
  },
  transferBtn: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopLeftRadius: 99,
    borderBottomLeftRadius: 99,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
  },
  transferText: { 
    fontSize: FONT_SIZES.lg, 
    color: COLORS.textPrimary, 
    textAlign: 'center', 
    paddingHorizontal: SPACING.sm
  },
});

export default NavigateTransfer;