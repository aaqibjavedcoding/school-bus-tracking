import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DocumentOwnerScreen } from '../../../../../src/features/admin/documents/DocumentOwnerScreen';

/**
 * Compliance documents of one bus (Task 44).
 *
 * `/manage/documents/bus/:id` — pushed from the documents overview. The screen
 * itself is shared with the driver route because both catalogues carry the same
 * fields; only the owner type differs.
 */
export default function BusDocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentOwnerScreen ownerType="BUS" ownerId={String(id ?? '')} />;
}
