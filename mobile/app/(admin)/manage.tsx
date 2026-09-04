import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Screen, SectionTitle } from '../../src/components';

/**
 * School-admin "Manage" hub — one tap to every management surface the web
 * console exposes: students, buses, routes & stops, drivers & conductors,
 * guardians, route assignments (dispatch), compliance documents and the
 * emergency feed. Each item opens a full create / edit / delete screen.
 */

interface ManageItem {
  href: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
}

const ITEMS: ManageItem[] = [
  {
    href: '/manage/students',
    title: 'Students',
    description: 'Roster, profiles & guardians',
    icon: 'school',
    tone: colors.primary[600],
  },
  {
    href: '/manage/buses',
    title: 'Buses',
    description: 'Fleet vehicles & capacity',
    icon: 'bus',
    tone: colors.secondary[600],
  },
  {
    href: '/manage/routes',
    title: 'Routes & stops',
    description: 'Runs and boarding sequence',
    icon: 'git-branch',
    tone: colors.status.info,
  },
  {
    href: '/manage/staff',
    title: 'Drivers & conductors',
    description: 'Crew accounts',
    icon: 'people',
    tone: colors.primary[700],
  },
  {
    href: '/manage/assignments',
    title: 'Assignments',
    description: 'Roster crew to routes & buses',
    icon: 'link',
    tone: colors.status.warning,
  },
  {
    href: '/manage/guardians',
    title: 'Guardians',
    description: 'Parent accounts',
    icon: 'person-circle',
    tone: colors.secondary[700],
  },
  {
    href: '/manage/documents',
    title: 'Documents',
    description: 'RC, insurance, licences & expiry',
    icon: 'document-text',
    tone: colors.status.info,
  },
  {
    href: '/emergencies',
    title: 'Emergencies',
    description: 'Live crew SOS & history',
    icon: 'warning',
    tone: colors.status.danger,
  },
];

export default function ManageHubScreen() {
  const router = useRouter();

  return (
    <Screen>
      <SectionTitle>Manage your school</SectionTitle>
      <Text style={styles.intro}>
        Everything the web console manages, in your pocket — create, edit and remove records.
      </Text>

      <View style={styles.grid}>
        {ITEMS.map((item) => (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href as never)}
            style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
          >
            <View style={[styles.icon, { backgroundColor: `${item.tone}1a` }]}>
              <Ionicons name={item.icon} size={22} color={item.tone} />
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDescription}>{item.description}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    flexBasis: '47.5%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 6,
    minHeight: 120,
  },
  cardPressed: {
    opacity: 0.7,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cardDescription: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
  },
});
