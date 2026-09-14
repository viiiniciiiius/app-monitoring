import React from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { SelectedAsset } from '../types';
import { COLORS, SPACING } from '../theme';

export const renderImage = ({ item }: { item: SelectedAsset }) => (
  <View style={styles.imageContainer}>
    <Image source={{ uri: item.uri }} style={styles.image} />
  </View>
);

const styles = StyleSheet.create({
  imageContainer: {
    flex: 1, 
    margin: SPACING.sm, 
    alignItems: 'center',
    backgroundColor: COLORS.headerBackground,
    borderRadius: 16,
    padding: SPACING.md,
  },
  image: {
    width: 102,
    height: 102,
    borderRadius: 12, 
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.textPrimary,
  },
});
