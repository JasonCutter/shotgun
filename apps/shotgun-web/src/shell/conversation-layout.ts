import type { GlobalShellView } from '@shotgun/api-client';

/** The server-owned VP capability selects the current single-space product UI. */
export const isConversationLayoutEnabled = (shell: GlobalShellView): boolean =>
  shell.features.some(
    (feature) => feature.id === 'vp-autonomous-knowledge' && feature.availability === 'AVAILABLE',
  );
