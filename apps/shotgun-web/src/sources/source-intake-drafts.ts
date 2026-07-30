import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { decodeIntakeDraftSeed, type IntakeDraftSeed } from '@shotgun/api-client';

import { useLeaveGuard } from '../session/leave-guard-context.js';

export type SourceIntakeDraftItem =
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly kind: 'DIRECT_TEXT';
      readonly label: string;
      readonly text: string;
      readonly validation: 'READY' | 'INVALID';
      readonly message: string;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly kind: 'FILE';
      readonly label: string;
      readonly file: File;
      readonly validation: 'READY' | 'INVALID';
      readonly message: string;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly kind: 'FILE_METADATA';
      readonly label: string;
      readonly fileName: string;
      readonly mediaType: string;
      readonly sizeBytes: number;
      readonly validation: 'ACTION_REQUIRED';
      readonly message: string;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly kind: 'URL';
      readonly label: string;
      readonly requestedUrl: string;
      readonly validation: 'READY' | 'INVALID';
      readonly message: string;
    };

const supportedFileTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);

let nextDraftItemId = 0;
const createId = (): string => {
  nextDraftItemId += 1;
  return `route-draft-${nextDraftItemId}`;
};

const decodeSeed = (
  seed: unknown,
  activeProjectId: string,
): { readonly seed?: IntakeDraftSeed; readonly items: readonly SourceIntakeDraftItem[] } => {
  if (seed === undefined) return { items: [] };
  try {
    const decoded = decodeIntakeDraftSeed(seed);
    const common = {
      draftItemId: `seed:${decoded.seedId}`,
      projectId: decoded.projectId,
      label: decoded.input.label,
    };
    if (decoded.input.kind === 'DIRECT_TEXT') {
      return {
        seed: decoded,
        items: [
          {
            ...common,
            kind: 'DIRECT_TEXT',
            text: decoded.input.text,
            validation: decoded.input.text.trim() ? 'READY' : 'INVALID',
            message: 'Seeded Direct Text must be reviewed before submission.',
          },
        ],
      };
    }
    if (decoded.input.kind === 'URL') {
      return {
        seed: decoded,
        items: [
          {
            ...common,
            kind: 'URL',
            requestedUrl: decoded.input.requestedUrl,
            validation: 'READY',
            message: 'The Server will repeat URL safety validation on submission.',
          },
        ],
      };
    }
    return {
      seed: decoded,
      items: [
        {
          ...common,
          kind: 'FILE_METADATA',
          fileName: decoded.input.fileName,
          mediaType: decoded.input.mediaType,
          sizeBytes: decoded.input.sizeBytes,
          validation: 'ACTION_REQUIRED',
          message: 'Choose the file again. A seed cannot supply browser file bytes.',
        },
      ],
    };
  } catch {
    return {
      items: [],
      seed: {
        schemaVersion: '1.0.0',
        seedId: 'invalid-seed',
        projectId: activeProjectId,
        originatingWorkspace: 'unknown',
        input: {
          kind: 'DIRECT_TEXT',
          label: 'Invalid seed',
          text: 'Invalid seed rejected.',
        },
      },
    };
  }
};

export const useSourceIntakeDraftQueue = (activeProjectId: string, seedInput?: unknown) => {
  const initial = useMemo(
    () => decodeSeed(seedInput, activeProjectId),
    [activeProjectId, seedInput],
  );
  const [items, setItems] = useState<readonly SourceIntakeDraftItem[]>(initial.items);
  const itemsRef = useRef<readonly SourceIntakeDraftItem[]>(initial.items);
  const [draftProjectId, setDraftProjectId] = useState(
    initial.items[0]?.projectId ?? activeProjectId,
  );
  const { registerLeaveGuard } = useLeaveGuard();

  const updateItems = useCallback(
    (
      updater: (
        current: readonly SourceIntakeDraftItem[],
      ) => readonly SourceIntakeDraftItem[],
    ) => {
      const nextItems = updater(itemsRef.current);
      itemsRef.current = nextItems;
      setItems(nextItems);
    },
    [],
  );

  useEffect(
    () =>
      registerLeaveGuard(() => {
        const hasUnsavedDraft = itemsRef.current.length > 0;
        return {
          canLeaveCurrentContext: !hasUnsavedDraft,
          hasUnsavedDraft,
          hasBlockingDialog: false,
          hasOutcomeUnknownCommand: false,
        };
      }),
    [registerLeaveGuard],
  );

  useEffect(() => {
    if (items.length === 0) setDraftProjectId(activeProjectId);
  }, [activeProjectId, items.length]);

  const addDirectText = (label: string, text: string) => {
    const trimmed = text.trim();
    const sizeValid = new TextEncoder().encode(text).byteLength <= 10 * 1024 * 1024;
    updateItems((current) => [
      ...current,
      {
        draftItemId: createId(),
        projectId: draftProjectId,
        kind: 'DIRECT_TEXT',
        label: label.trim() || 'Direct Text',
        text,
        validation: trimmed.length > 0 && sizeValid ? 'READY' : 'INVALID',
        message:
          trimmed.length === 0
            ? 'Direct Text cannot be empty.'
            : !sizeValid
              ? 'Direct Text exceeds the current 10 MiB advisory limit.'
              : 'Client preflight passed. The Server will validate again.',
      },
    ]);
  };

  const addFile = (label: string, file: File) => {
    const supported = supportedFileTypes.has(file.type);
    const sizeValid = file.size > 0 && file.size <= 10 * 1024 * 1024;
    updateItems((current) => [
      ...current,
      {
        draftItemId: createId(),
        projectId: draftProjectId,
        kind: 'FILE',
        label: label.trim() || file.name,
        file,
        validation: supported && sizeValid ? 'READY' : 'INVALID',
        message: !supported
          ? 'The declared file type is not in the client advisory allowlist.'
          : !sizeValid
            ? 'The file must be between 1 byte and 10 MiB.'
            : 'Client preflight passed. The Server will verify bytes, type and filename.',
      },
    ]);
  };

  const addUrl = (label: string, requestedUrl: string) => {
    let valid = false;
    try {
      valid = ['http:', 'https:'].includes(new URL(requestedUrl).protocol);
    } catch {
      valid = false;
    }
    updateItems((current) => [
      ...current,
      {
        draftItemId: createId(),
        projectId: draftProjectId,
        kind: 'URL',
        label: label.trim() || 'URL',
        requestedUrl,
        validation: valid ? 'READY' : 'INVALID',
        message: valid
          ? 'Descriptor accepted locally. The Server will perform all acquisition and SSRF validation.'
          : 'Enter an absolute HTTP(S) URL.',
      },
    ]);
  };

  return {
    items,
    draftProjectId,
    activeProjectMismatch: items.length > 0 && draftProjectId !== activeProjectId,
    invalidSeed: initial.seed?.seedId === 'invalid-seed',
    addDirectText,
    addFile,
    addUrl,
    remove: (draftItemId: string) =>
      updateItems((current) => current.filter((item) => item.draftItemId !== draftItemId)),
    discardAll: () => updateItems(() => []),
  };
};