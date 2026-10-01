import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { BusMarkerGraphic } from './BusMarkerGraphic';

export interface MapLegendProps {
  onClose: () => void;
  plannedOrderDetail?: string | null;
  arrivalZoneDetail?: string | null;
}

/** Compact, on-demand legend. It intentionally uses the shared bus sprite. */
export const MapLegend: React.FC<MapLegendProps> = ({
  onClose,
  plannedOrderDetail = null,
  arrivalZoneDetail = null,
}) => {
  useTranslation();
  return (
    <View style={styles.panel} accessibilityRole="summary">
      <View style={styles.header}>
        <Text style={styles.title}>{t('map.legend.title')}</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('map.legend.close')}
          hitSlop={8}
          style={styles.close}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <LegendRow label={t('map.legend.bus')} swatch={<BusMarkerGraphic width={13} height={21} />} />
      <LegendRow label={t('map.legend.nextStop')} swatch={<View style={styles.nextStop} />} />
      <LegendRow label={t('map.legend.stop')} swatch={<View style={styles.stop} />} />
      <LegendRow label={t('map.legend.drivenPath')} swatch={<View style={styles.drivenPath} />} />
      <LegendRow
        label={t('map.legend.plannedOrder')}
        detail={plannedOrderDetail}
        swatch={<View style={styles.plannedOrder} />}
      />
      {arrivalZoneDetail ? (
        <LegendRow
          label={t('map.legend.arrivalZone')}
          detail={arrivalZoneDetail}
          swatch={<View style={styles.zone} />}
        />
      ) : null}
    </View>
  );
};

const LegendRow: React.FC<{
  label: string;
  detail?: string | null;
  swatch: React.ReactNode;
}> = ({ label, detail = null, swatch }) => (
  <View style={styles.row}>
    <View style={styles.swatch}>{swatch}</View>
    <View style={styles.labelGroup}>
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    zIndex: 20,
    top: 52,
    right: spacing.sm,
    width: 232,
    gap: 5,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  title: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  close: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  closeText: {
    fontSize: typography.fontSizes.lg,
    lineHeight: 20,
    color: colors.neutral[600],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 24,
  },
  swatch: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelGroup: {
    flex: 1,
  },
  label: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  detail: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[600],
  },
  nextStop: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary[600],
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  stop: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.neutral[700],
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  drivenPath: {
    width: 25,
    borderTopWidth: 3,
    borderStyle: 'dashed',
    borderColor: colors.status.success,
  },
  plannedOrder: {
    width: 25,
    borderTopWidth: 4,
    borderColor: colors.primary[600],
  },
  zone: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary[700],
  },
});
