import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TripEtaResponse, TripResponse } from '@school-bus-tracking/shared-types';
import { spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { fontScaleCaps } from '../../theme';
import { formatEtaMinutes } from '../../lib/format';
import { tripStatusStyle } from './trip-status-style';
import { crewCopy } from './crew-copy';
import { useTranslation } from '../../lib/i18n-provider';

/**
 * The crew trip screen's giant status card (Phase 2): **the background
 * colour *is* the state** — BOARDING green, IN_PROGRESS amber, settled grey
 * (mapping pinned by `trip-status-style.spec.ts`). It carries, top to
 * bottom, the only things a driver reads while working:
 *
 * 1. the state word (28px bold) with its icon — colour is never the only
 *    cue, the word and glyph repeat it;
 * 2. the next stop + ETA (24px) — where the bus goes next;
 * 3. exactly **one** primary action (the `action` slot, 64px).
 *
 * Everything else (route code, scheduled time, bus reg no., role, connection,
 * departed/arrived stamps) is *de-prioritised, not deleted*: it moves into
 * the collapsible "More details" section below the fold of attention.
 */
export const StatusCard: React.FC<{
  trip: TripResponse;
  eta: TripEtaResponse | null;
  /** The single primary action (rendered right under the next-stop line). */
  action?: React.ReactNode;
  /** Collapsed-by-default metadata (`KeyValue` rows, stamps, counts…). */
  details?: React.ReactNode;
}> = ({ trip, eta, action, details }) => {
  // Subscribes to the locale: this card carries the state word, the next-stop
  // line and the details labels, all of them translated.
  useTranslation();
  const style = tripStatusStyle(trip.status);
  const [expanded, setExpanded] = useState(false);
  const [reveal] = useState(() => new Animated.Value(0));

  const toggleDetails = () => {
    const next = !expanded;
    setExpanded(next);
    Animated.timing(reveal, {
      toValue: next ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const nextStopLine = nextStopSummary(eta);

  return (
    <View style={[styles.card, { backgroundColor: style.background }]}>
      <View style={styles.stateRow}>
        <Ionicons name={style.icon as never} size={30} color={style.foreground} />
        <Text {...fontScaleCaps.label} style={[styles.stateWord, { color: style.foreground }]}>
          {style.word}
        </Text>
      </View>

      <Text {...fontScaleCaps.label} style={[styles.nextStop, { color: style.foreground }]}>
        {nextStopLine.headline}
      </Text>
      {nextStopLine.subline ? (
        <Text {...fontScaleCaps.label} style={[styles.nextStopSub, { color: style.foreground }]}>
          {nextStopLine.subline}
        </Text>
      ) : null}

      {action ? <View style={styles.actionArea}>{action}</View> : null}

      {details ? (
        <View style={styles.detailsArea}>
          <Pressable
            onPress={toggleDetails}
            accessibilityRole="button"
            accessibilityLabel={expanded ? crewCopy.detailsToggleHide : crewCopy.detailsToggle}
            accessibilityState={{ expanded }}
            style={styles.detailsToggle}
          >
            <Text
              {...fontScaleCaps.label}
              style={[styles.detailsToggleText, { color: style.foreground }]}
            >
              {expanded ? crewCopy.detailsToggleHide : crewCopy.detailsToggle}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={style.foreground}
            />
          </Pressable>
          {expanded ? (
            <Animated.View style={[styles.detailsBody, { opacity: reveal }]}>
              <View style={styles.detailsSheet}>{details}</View>
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

interface NextStopSummary {
  headline: string;
  subline: string | null;
}

/** Server-computed ETA only — the client never invents a stop or a time. */
export function nextStopSummary(eta: TripEtaResponse | null): NextStopSummary {
  if (!eta || !eta.eta_available) {
    return { headline: crewCopy.nextStopFallback, subline: null };
  }
  if (!eta.next_stop) {
    return { headline: crewCopy.allStopsDone, subline: null };
  }
  const etaMinutes = formatEtaMinutes(eta.next_stop.eta_minutes);
  return {
    // The stop name is data — it goes in as the server sent it.
    headline: crewCopy.nextStop(eta.next_stop.stop_name),
    subline: etaMinutes ? crewCopy.etaLine(etaMinutes) : crewCopy.etaUnavailable,
  };
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateWord: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  nextStop: {
    fontSize: 24,
    fontWeight: '700',
  },
  nextStopSub: {
    fontSize: 20,
    fontWeight: '600',
    opacity: 1,
  },
  actionArea: {
    marginTop: spacing.xs,
  },
  detailsArea: {
    marginTop: spacing.xs,
  },
  detailsToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailsToggleText: {
    fontSize: 16,
    fontWeight: '700',
  },
  detailsBody: {},
  detailsSheet: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
