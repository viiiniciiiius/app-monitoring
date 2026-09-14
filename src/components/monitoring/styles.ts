import { StyleSheet } from 'react-native';

import { COLORS, FONT_SIZES, SPACING } from '../../theme';

export const monitoringStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    paddingTop: SPACING.xxxl * 2,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  cameraContainer: {
    width: 2,
    height: 2,
    overflow: 'hidden',
    opacity: 0.02,
  },
  camera: {
    flex: 1,
  },
  title: {
    color: COLORS.success,
    fontSize: FONT_SIZES.lx,
    marginBottom: SPACING.sm,
  },
  textSecondary: {
    fontSize: FONT_SIZES.lx,
    paddingTop: SPACING.xl,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  statusText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  detailText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  listContainer: {
    paddingBottom: SPACING.lg,
  },
  logItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
  },
  errorLogText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.md,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 99,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.md,
  },
  stopButton: {
    backgroundColor: COLORS.headerBackground,
  },
  actionButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    textAlign: 'center',
  },
});
