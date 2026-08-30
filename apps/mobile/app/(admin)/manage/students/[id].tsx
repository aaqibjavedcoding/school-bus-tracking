import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type {
  ParentListResponse,
  ParentResponse,
  RouteListResponse,
  RouteResponse,
  StopListResponse,
  StopResponse,
  StudentGuardianListResponse,
  StudentGuardianResponse,
  StudentResponse,
} from '@school-bus-tracking/shared-types';
import { studentGuardianCreateSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../../src/services/api';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../src/lib/errors';
import { invalidIdMessage, isUuid } from '../../../../src/lib/ids';
import { fullName, stopCode } from '../../../../src/lib/format';
import { useLoad } from '../../../../src/hooks/useLoad';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  FormSheet,
  KeyValue,
  LoadingView,
  Screen,
  Select,
  SectionTitle,
  useToast,
} from '../../../../src/components';

/**
 * School-admin student detail — profile, home stop and guardians, with
 * link-existing-parent and unlink actions matching the web student page.
 */
export default function ManageStudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const studentId = typeof id === 'string' ? id : '';
  const usableId = isUuid(studentId);

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    student: StudentResponse;
    guardians: StudentGuardianResponse[];
    parents: ParentResponse[];
    stops: StopResponse[];
    routes: RouteResponse[];
  }> => {
    if (!usableId) throw new Error(invalidIdMessage('student'));
    const [student, guardians, parents, stops, routes] = await Promise.all([
      apiClient.getStudent(studentId),
      apiClient.listStudentGuardians(studentId),
      apiClient.listParents({ page: 1, limit: 100 }),
      apiClient.listStops({ page: 1, limit: 100 }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
    ]);
    return {
      student: unwrapEnvelope<StudentResponse>(student),
      guardians: unwrapEnvelope<StudentGuardianListResponse>(guardians).items,
      parents: unwrapEnvelope<ParentListResponse>(parents).items,
      stops: unwrapEnvelope<StopListResponse>(stops).items,
      routes: unwrapEnvelope<RouteListResponse>(routes).items,
    };
  }, [studentId, usableId]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [parentId, setParentId] = useState('');
  const [relationship, setRelationship] = useState('Parent');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingUnlink, setPendingUnlink] = useState<StudentGuardianResponse | null>(null);

  const link = async () => {
    const parsed = studentGuardianCreateSchema.safeParse({
      parent_id: parentId,
      relationship,
      is_primary: false,
      can_pick_up: true,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.createStudentGuardian(studentId, parsed.data));
      toast.push('Guardian linked.', 'success');
      setLinkOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!pendingUnlink) return;
    setBusy(true);
    try {
      await apiClient.deleteStudentGuardian(studentId, pendingUnlink.parent_id);
      toast.push('Guardian unlinked.', 'success');
      setPendingUnlink(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <LoadingView label="Loading student…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Student not found'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const parentName = (guardian: StudentGuardianResponse) => {
    const parent = data.parents.find((entry) => entry.id === guardian.parent_id);
    return parent ? `${fullName(parent)} (${parent.email})` : 'Guardian unavailable';
  };

  const homeStop = data.stops.find((stop) => stop.id === data.student.home_stop_id);
  const homeStopRoute = data.routes.find((route) => route.id === homeStop?.route_id);
  const homeStopLabel =
    homeStop && homeStopRoute
      ? `${stopCode(homeStopRoute.code, homeStop.sequence_number)} — ${homeStop.name}`
      : data.student.home_stop_name ?? 'Not assigned';

  const linkedIds = new Set(data.guardians.map((guardian) => guardian.parent_id));
  const parentOptions = data.parents
    .filter((parent) => !linkedIds.has(parent.id))
    .map((parent) => ({ value: parent.id, label: `${fullName(parent)} (${parent.email})` }));

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void reload()} refreshing={loading}>
        <Pressable onPress={() => router.back()} style={styles.backRow} accessibilityRole="button">
          <Text style={styles.backText}>‹ Back to roster</Text>
        </Pressable>

        <Card title={fullName(data.student)}>
          <View style={styles.badgeRow}>
            <Badge
              label={data.student.is_active ? 'Active' : 'Inactive'}
              tone={data.student.is_active ? 'success' : 'neutral'}
            />
          </View>
          <View style={styles.kvRow}>
            <KeyValue label="Admission no." value={data.student.admission_number} />
            <KeyValue label="Grade" value={data.student.grade_level ?? '—'} />
          </View>
          <View style={styles.kvRow}>
            <KeyValue label="Home stop" value={homeStopLabel} />
          </View>
          <View style={styles.kvRow}>
            <KeyValue
              label="Emergency contact"
              value={
                data.student.emergency_contact_name
                  ? `${data.student.emergency_contact_name}${data.student.emergency_contact_phone ? ` · ${data.student.emergency_contact_phone}` : ''}`
                  : '—'
              }
            />
          </View>
          {data.student.medical_notes ? (
            <View style={styles.kvRow}>
              <KeyValue label="Medical notes" value={data.student.medical_notes} />
            </View>
          ) : null}
        </Card>

        <View style={styles.sectionHeader}>
          <SectionTitle>Guardians</SectionTitle>
          <Button
            label="Link parent"
            small
            onPress={() => {
              setParentId('');
              setRelationship('Parent');
              setFieldErrors({});
              setLinkOpen(true);
            }}
          />
        </View>

        {data.guardians.length === 0 ? (
          <Text style={styles.muted}>No guardians linked yet.</Text>
        ) : (
          data.guardians.map((guardian) => (
            <View key={guardian.id} style={styles.guardianRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.guardianName}>{parentName(guardian)}</Text>
                <Text style={styles.guardianMeta}>
                  {guardian.relationship}
                  {guardian.is_primary ? ' · Primary' : ''}
                  {guardian.can_pick_up ? ' · Can pick up' : ''}
                </Text>
              </View>
              <Pressable onPress={() => setPendingUnlink(guardian)} hitSlop={6} style={styles.unlink}>
                <Ionicons name="close-circle-outline" size={20} color={colors.status.danger} />
              </Pressable>
            </View>
          ))
        )}
      </Screen>

      <FormSheet
        open={linkOpen}
        title="Link parent"
        onClose={() => setLinkOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setLinkOpen(false)} style={styles.flex} />
            <Button label="Link" onPress={() => void link()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="Parent"
          value={parentId}
          onChange={setParentId}
          options={parentOptions}
          placeholder="Select parent"
          error={fieldErrors.parent_id}
        />
        <Field
          label="Relationship"
          value={relationship}
          onChangeText={setRelationship}
          autoCapitalize="words"
          error={fieldErrors.relationship}
        />
        {parentOptions.length === 0 ? (
          <Text style={styles.muted}>
            All parent accounts are already linked. Create more under Manage → Guardians.
          </Text>
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingUnlink)}
        title="Unlink guardian?"
        message={pendingUnlink ? `${parentName(pendingUnlink)} will no longer follow this child.` : ''}
        confirmLabel="Unlink"
        danger
        busy={busy}
        onConfirm={() => void unlink()}
        onCancel={() => setPendingUnlink(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backRow: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.primary[700], fontSize: 15, fontWeight: '600' },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  kvRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
    marginTop: spacing.xs,
  },
  guardianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  guardianName: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  guardianMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  unlink: {
    padding: spacing.xs,
  },
});
