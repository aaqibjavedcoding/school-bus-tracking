import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ShiftCreateRequest,
  ShiftResponse,
  ShiftUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { shiftCreateSchema, shiftUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { usePagedResource } from '../../../src/hooks/usePagedResource';
import {
  ACTIVE_FILTER_OPTIONS,
  activeFilterLabel,
  type ActiveFilter,
} from '../../../src/lib/active-filter';
import { trimSeconds } from '../../../src/lib/runs';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterChips,
  FilterSummary,
  Fab,
  Field,
  FormSheet,
  ListCard,
  ListScreen,
  LoadingView,
  Pagination,
  SearchBar,
  SwitchRow,
  useToast,
} from '../../../src/components';

const EMPTY = { name: '', start_time: '', end_time: '', is_active: true };

/**
 * Bell windows (`docs/operating-model.md` §3.1) — the mobile twin of the web
 * Shifts page. A shift is the clock runs sit in; the conflict engine compares
 * these windows, so this screen is where bus tiering starts. Deleting a shift
 * is refused (409) while runs are attached to it; the API message surfaces
 * verbatim in the toast.
 *
 * Unlike buses/routes (client-side narrowing over the loaded page), the
 * shifts list endpoint accepts `is_active` server-side, so the chips drive
 * the actual query — paginated totals stay truthful.
 */
export default function ManageShiftsScreen() {
  const toast = useToast();
  const [filter, setFilter] = useState<ActiveFilter>('ALL');
  const isActiveParam = filter === 'ALL' ? undefined : filter === 'ACTIVE';

  const list = usePagedResource<ShiftResponse>(
    async (page, search) =>
      unwrapEnvelope(
        await apiClient.listShifts({ page, limit: 20, search, is_active: isActiveParam }),
      ),
    [isActiveParam],
  );

  const filtersActive = Boolean(list.activeSearch) || filter !== 'ALL';
  const resetFilters = () => {
    list.clearSearch();
    setFilter('ALL');
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ShiftResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (shift: ShiftResponse) => {
    setEditing(shift);
    setForm({
      name: shift.name,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      is_active: shift.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload: ShiftCreateRequest = {
      name: form.name.trim(),
      start_time: form.start_time.trim(),
      end_time: form.end_time.trim(),
      is_active: form.is_active,
    };
    const parsed = editing
      ? shiftUpdateSchema.safeParse(payload satisfies ShiftUpdateRequest)
      : shiftCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateShift(editing.id, parsed.data as ShiftUpdateRequest));
        toast.push('Shift updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createShift(parsed.data as ShiftCreateRequest));
        toast.push('Shift added.', 'success');
      }
      setOpen(false); // Reset only happens after a successful save.
      await list.reload();
    } catch (caught) {
      // On failure the sheet stays open with the entered values intact.
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteShift(pendingDelete.id);
      toast.push('Shift removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ListScreen
        data={list.items}
        keyExtractor={(shift) => shift.id}
        renderItem={({ item }) => (
          <ListCard
            title={item.name}
            subtitle={`${trimSeconds(item.start_time)} – ${trimSeconds(item.end_time)}`}
            meta={
              item.run_count != null
                ? `${item.run_count} run${item.run_count === 1 ? '' : 's'}`
                : undefined
            }
            right={
              <Badge
                label={item.is_active ? 'Active' : 'Inactive'}
                tone={item.is_active ? 'success' : 'neutral'}
              />
            }
            onEdit={() => startEdit(item)}
            onDelete={() => setPendingDelete(item)}
          />
        )}
        header={
          <>
            <SearchBar
              value={list.search}
              onChangeText={list.setSearch}
              onClear={list.clearSearch}
              searching={list.searching}
              placeholder="Search shifts…"
            />
            <FilterChips<ActiveFilter>
              options={ACTIVE_FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
            />
            {filtersActive ? (
              <FilterSummary
                label={[
                  list.activeSearch ? `“${list.activeSearch}”` : null,
                  filter !== 'ALL' ? activeFilterLabel(filter) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={resetFilters}
              />
            ) : null}
            {list.items.length > 0 ? (
              <Text style={styles.count}>
                {filtersActive
                  ? `${list.items.length} of ${list.meta.total} shifts`
                  : `${list.meta.total} shifts`}
              </Text>
            ) : null}
          </>
        }
        footer={
          list.items.length > 0 ? <Pagination meta={list.meta} onPage={list.setPage} /> : null
        }
        empty={
          list.loading && list.items.length === 0 ? (
            <LoadingView label="Loading shifts…" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : (
            <EmptyState
              title={filtersActive ? 'No shifts match' : 'No shifts yet'}
              description={
                filtersActive
                  ? 'No shifts match the current search or filters.'
                  : 'Add the first bell window (e.g. Morning 07:00–11:00), then attach runs to it.'
              }
              action={
                filtersActive ? (
                  <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
                ) : null
              }
            />
          )
        }
        refresh={() => void list.refresh()}
        refreshing={list.refreshing}
        extraBottomSpace={72}
      />

      <Fab onPress={startCreate} label="Add shift" />

      <FormSheet
        open={open}
        title={editing ? 'Edit shift' : 'Add shift'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setOpen(false)}
              style={styles.flex}
            />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Field
          label="Name"
          value={form.name}
          onChangeText={(text) => setForm({ ...form, name: text })}
          autoCapitalize="words"
          placeholder="Morning"
          error={fieldErrors.name}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="Start (HH:MM)"
              value={form.start_time}
              onChangeText={(text) => setForm({ ...form, start_time: text })}
              placeholder="07:00"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              error={fieldErrors.start_time}
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="End (HH:MM)"
              value={form.end_time}
              onChangeText={(text) => setForm({ ...form, end_time: text })}
              placeholder="11:00"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              error={fieldErrors.end_time}
            />
          </View>
        </View>
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete shift?"
        message={
          pendingDelete
            ? `${pendingDelete.name} (${trimSeconds(pendingDelete.start_time)}–${trimSeconds(pendingDelete.end_time)}) will be removed. The API refuses while runs still use it.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
});
