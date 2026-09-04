import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DocumentOwnerScreen } from '../../../../../src/features/admin/documents/DocumentOwnerScreen';

/**
 * Compliance documents of one driver (Task 44).
 *
 * `/manage/documents/driver/:id` — pushed from the documents overview. The
 * driving licence is required by default; the rest follows the school's own
 * configuration under "Document requirements".
 */
export default function DriverDocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentOwnerScreen ownerType="DRIVER" ownerId={String(id ?? '')} />;
}
