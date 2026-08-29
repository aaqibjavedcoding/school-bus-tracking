import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { fitViewport, polylinePath, rotationForHeading, type LatLng } from '../../utils/geo';

/**
 * Zero-dependency map canvas for phones (Task 23 §H).
 *
 * Visualises exactly what the brief asks — bus position, stops, route
 * polyline where coordinates exist, plus highlighted home / current / next
 * stops — and nothing else. Coordinates arrive from the existing backend
 * responses; no routing/ETA/geofence math happens here and no paid map API
 * is introduced. Pan/zoom is intentionally minimal (zoom buttons): the view
 * auto-fits the visible route, which is what parents actually need.
 */

export interface MapStop extends LatLng {
  id: string;
  name: string;
  sequence?: number;
}

export interface MapBus extends LatLng {
  heading?: number | null;
}

export const BusMap: React.FC<{
  height?: number;
  stops: MapStop[];
  bus: MapBus | null;
  homeStopId?: string | null;
  currentStopId?: string | null;
  nextStopId?: string | null;
  geofenceRadiusByStopId?: Record<string, number>;
  caption?: string;
}> = ({
  height = 260,
  stops,
  bus,
  homeStopId,
  currentStopId,
  nextStopId,
  geofenceRadiusByStopId,
  caption,
}) => {
  const [size, setSize] = useState({ width: 0, height });
  const [zoom, setZoom] = useState(1);

  const onLayout = (event: LayoutChangeEvent): void => {
    setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  };

  const model = useMemo(() => {
    const points: LatLng[] = [
      ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ];
    if (bus) {
      points.push({ latitude: bus.latitude, longitude: bus.longitude });
    }
    const { project } = fitViewport(points, {
      width: size.width || 320,
      height: size.height || height,
      padding: 26,
    });
    const scale = (point: LatLng): { x: number; y: number } => {
      const p = project(point);
      const cx = (size.width || 320) / 2;
      const cy = (size.height || height) / 2;
      return { x: cx + (p.x - cx) * zoom, y: cy + (p.y - cy) * zoom };
    };
    const stopPoints = stops.map((stop) => ({ stop, at: scale(stop) }));
    const path = polylinePath(stopPoints.map((entry) => entry.at));
    const busAt = bus ? scale(bus) : null;
    return { stopPoints, path, busAt };
  }, [stops, bus, size, zoom, height]);

  const hasCoordinates = model.stopPoints.some((entry) => Number.isFinite(entry.at.x));

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height} accessibilityLabel="Route map">
          {model.path && stops.length > 1 ? (
            <Path
              d={model.path}
              stroke={colors.primary[400]}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          ) : null}
          {model.stopPoints.map(({ stop, at }) => {
            const isHome = stop.id === homeStopId;
            const isCurrent = stop.id === currentStopId;
            const isNext = stop.id === nextStopId;
            const radius = isHome || isCurrent ? 8 : 6;
            const fill = isCurrent
              ? colors.status.info
              : isHome
                ? colors.secondary[600]
                : isNext
                  ? colors.primary[500]
                  : colors.neutral[400];
            const geofence = geofenceRadiusByStopId?.[stop.id];
            return (
              <G key={stop.id}>
                {geofence !== undefined && hasCoordinates ? (
                  <Circle
                    cx={at.x}
                    cy={at.y}
                    r={Math.max(10, Math.min(radius + geofence / 30, 40))}
                    fill="rgba(37, 99, 235, 0.08)"
                    stroke="rgba(37, 99, 235, 0.35)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ) : null}
                <Circle
                  cx={at.x}
                  cy={at.y}
                  r={radius}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <SvgText
                  x={at.x}
                  y={at.y - radius - 4}
                  fill={colors.neutral[600]}
                  fontSize={9}
                  textAnchor="middle"
                >
                  {`${stop.sequence != null ? `${stop.sequence}. ` : ''}${stop.name.length > 16 ? `${stop.name.slice(0, 15)}…` : stop.name}`}
                </SvgText>
              </G>
            );
          })}
          {model.busAt ? (
            <G x={model.busAt.x} y={model.busAt.y}>
              <Circle r={14} fill="rgba(245, 158, 11, 0.25)" />
              <Polygon
                points={`0,-10 8,8 0,4 -8,8`}
                fill={colors.primary[500]}
                stroke="#ffffff"
                strokeWidth={1.5}
                transform={`rotate(${bus ? rotationForHeading(bus.heading) : 0})`}
              />
            </G>
          ) : null}
          {stops.length === 0 && !bus ? (
            <SvgText
              x={size.width / 2}
              y={size.height / 2}
              fill={colors.neutral[400]}
              fontSize={12}
              textAnchor="middle"
            >
              No coordinates to plot
            </SvgText>
          ) : null}
        </Svg>
      ) : (
        <View onLayout={onLayout} style={StyleSheet.absoluteFill} />
      )}
      <View style={styles.zoomColumn}>
        <Text
          style={styles.zoomButton}
          accessibilityRole="button"
          onPress={() => setZoom((z) => Math.min(z * 1.4, 6))}
        >
          +
        </Text>
        <Text
          style={styles.zoomButton}
          accessibilityRole="button"
          onPress={() => setZoom((z) => Math.max(z / 1.4, 0.5))}
        >
          −
        </Text>
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
};

/** Small static legend used next to the map (no map library involved). */
export const MapLegend: React.FC = () => (
  <View style={styles.legend}>
    <LegendDot color={colors.primary[500]} label="Bus" />
    <LegendDot color={colors.secondary[600]} label="Home stop" />
    <LegendDot color={colors.status.info} label="Current stop" />
    <LegendDot color={colors.primary[400]} label="Route" />
  </View>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendText}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  zoomColumn: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    gap: spacing.xs,
  },
  zoomButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    textAlign: 'center',
    lineHeight: 34,
    fontSize: 18,
    fontWeight: '800',
    color: colors.neutral[700],
    overflow: 'hidden',
  },
  caption: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    fontSize: 10,
    color: colors.neutral[500],
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.neutral[600],
  },
});
