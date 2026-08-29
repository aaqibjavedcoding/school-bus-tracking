import { Alert, Platform } from 'react-native';

/**
 * Promise wrapper over the native confirmation dialog — every destructive or
 * operational action (start trip, complete trip, cancel, delete, drop…) goes
 * through it so accidental taps cannot fire backend mutations.
 *
 * Resolves `true` only on explicit confirm; resolves `false` on cancel and on
 * dismissal. On web preview, `window.confirm` keeps the same semantics.
 */
export function confirmAction(
  title: string,
  message: string,
  options: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean } = {},
): Promise<boolean> {
  const confirmLabel = options.confirmLabel ?? 'Confirm';
  const cancelLabel = options.cancelLabel ?? 'Cancel';

  if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
    // RN-web/CI fallback; keeps behaviour testable without native dialogs.
    const win = (globalThis as { window?: { confirm: (m: string) => boolean } }).window;
    if (win?.confirm) {
      return Promise.resolve(win.confirm(`${title}\n\n${message}`));
    }
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: options.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Single-button notice dialog (used for GPS permission guidance, …). */
export function notify(title: string, message: string, buttonLabel = 'OK'): Promise<void> {
  return new Promise<void>((resolve) => {
    Alert.alert(title, message, [{ text: buttonLabel, onPress: () => resolve() }], {
      cancelable: true,
      onDismiss: () => resolve(),
    });
  });
}
