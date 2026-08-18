import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  decodeIntakeDraftSeed,
  type IntakeDraftSeed,
  type SourcesSensitivity,
} from '@shotgun/api-client';

import { useLeaveGuard } from '../session/leave-guard-context.js';

export type SourceIntakeDraftMessageCode =
  | 'SEEDED_TEXT_REVIEW'
  | 'SEEDED_TEXT_TOO_LARGE'
  | 'SEEDED_URL_VALIDATION'
  | 'SEED_FILE_RESELECT'
  | 'DIRECT_TEXT_EMPTY'
  | 'DIRECT_TEXT_TOO_LARGE'
  | 'CLIENT_PREFLIGHT'
  | 'FILE_UNSUPPORTED'
  | 'FILE_SIZE_INVALID'
  | 'FILE_PREFLIGHT'
  | 'URL_ACCEPTED'
  | 'URL_INVALID';

export type SourceIntakeDraftItem =
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly requestedClassification: SourcesSensitivity;
      readonly kind: 'DIRECT_TEXT';
      readonly label: string;
      readonly text: string;
      readonly validation: 'READY' | 'INVALID';
      readonly messageCode: SourceIntakeDraftMessageCode;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly requestedClassification: SourcesSensitivity;
      readonly kind: 'FILE';
      readonly label: string;
      readonly file: File;
      readonly validation: 'READY' | 'INVALID';
      readonly messageCode: SourceIntakeDraftMessageCode;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly requestedClassification: SourcesSensitivity;
      readonly kind: 'FILE_METADATA';
      readonly label: string;
      readonly fileName: string;
      readonly mediaType: string;
      readonly sizeBytes: number;
      readonly validation: 'ACTION_REQUIRED';
      readonly messageCode: SourceIntakeDraftMessageCode;
    }
  | {
      readonly draftItemId: string;
      readonly projectId: string;
      readonly requestedClassification: SourcesSensitivity;
      readonly kind: 'URL';
      readonly label: string;
      readonly requestedUrl: string;
      readonly validation: 'READY' | 'INVALID';
      readonly messageCode: SourceIntakeDraftMessageCode;
    };

const MAX_ACTIVE_BYTES = 1_048_576;
const supportedFileTypes = new Set(['text/plain', 'text/markdown']);

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
      // Intake seeds have no classification authority. Omission must remain
      // server-fail-closed when submitted, so Browser draft state uses private.
      requestedClassification: 'private' as const,
    };
    if (decoded.input.kind === 'DIRECT_TEXT') {
      const size = new TextEncoder().encode(decoded.input.text).byteLength;
      return {
        seed: decoded,
        items: [
          {
            ...common,
            kind: 'DIRECT_TEXT',
            text: decoded.input.text,
            validation: decoded.input.text.trim() && size <= MAX_ACTIVE_BYTES ? 'READY' : 'INVALID',
            messageCode: size <= MAX_ACTIVE_BYTES ? 'SEEDED_TEXT_REVIEW' : 'SEEDED_TEXT_TOO_LARGE',
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
            messageCode: 'SEEDED_URL_VALIDATION',
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
          messageCode: 'SEED_FILE_RESELECT',
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
    (updater: (current: readonly SourceIntakeDraftItem[]) => readonly SourceIntakeDraftItem[]) => {
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

  const addDirectText = (
    label: string,
    text: string,
    requestedClassification: SourcesSensitivity = 'private',
  ) => {
    const trimmed = text.trim();
    const sizeValid = new TextEncoder().encode(text).byteLength <= MAX_ACTIVE_BYTES;
    updateItems((current) => [
      ...current,
      {
        draftItemId: createId(),
        projectId: draftProjectId,
        requestedClassification,
        kind: 'DIRECT_TEXT',
        label: label.trim() || 'Direct Text',
        text,
        validation: trimmed.length > 0 && sizeValid ? 'READY' : 'INVALID',
        messageCode:
          trimmed.length === 0
            ? 'DIRECT_TEXT_EMPTY'
            : !sizeValid
              ? 'DIRECT_TEXT_TOO_LARGE'
              : 'CLIENT_PREFLIGHT',
      },
    ]);
  };

  const addFile = (
    label: string,
    file: File,
    requestedClassification: SourcesSensitivity = 'private',
  ) => {
    const supported = supportedFileTypes.has(file.type);
    const sizeValid = file.size > 0 && file.size <= MAX_ACTIVE_BYTES;
    updateItems((current) => [
      ...current,
      {
        draftItemId: createId(),
        projectId: draftProjectId,
        requestedClassification,
        kind: 'FILE',
        label: label.trim() || file.name,
        file,
        validation: supported && sizeValid ? 'READY' : 'INVALID',
        messageCode: !supported
          ? 'FILE_UNSUPPORTED'
          : !sizeValid
            ? 'FILE_SIZE_INVALID'
            : 'FILE_PREFLIGHT',
      },
    ]);
  };

  const addUrl = (
    label: string,
    requestedUrl: string,
    requestedClassification: SourcesSensitivity = 'private',
  ) => {
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
        requestedClassification,
        kind: 'URL',
        label: label.trim() || 'URL',
        requestedUrl,
        validation: valid ? 'READY' : 'INVALID',
        messageCode: valid ? 'URL_ACCEPTED' : 'URL_INVALID',
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
