import { useMemo, useState, type ChangeEvent } from 'react';
import { useKnowledgeDraft } from './knowledge-draft-controller.js';
import type {
  FrontendKnowledgeDraftChangeSetV1,
  FrontendKnowledgeDraftClient,
} from '@shotgun/api-client';

export type KnowledgeDraftEditorProps = {
  readonly draft: FrontendKnowledgeDraftChangeSetV1 | null | undefined;
  readonly activeProjectId?: string;
  readonly sessionId?: string;
  readonly client: Pick<FrontendKnowledgeDraftClient, 'saveDraft'>;
};

const initialEditorText = (draft: FrontendKnowledgeDraftChangeSetV1 | null | undefined) => {
  if (!draft) return '';
  return draft.operations.map((operation) => operation.after?.statement ?? '').join('\n');
};

export const KnowledgeDraftEditor = ({
  draft,
  activeProjectId,
  sessionId,
  client,
}: KnowledgeDraftEditorProps) => {
  const controller = useKnowledgeDraft(draft, activeProjectId, sessionId);
  const [editorText, setEditorText] = useState(() => initialEditorText(draft));

  useMemo(() => {
    setEditorText(initialEditorText(draft));
  }, [draft?.draftId, draft?.revision]);

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setEditorText(value);
    const operations = value
      .split(/\n/)
      .filter(Boolean)
      .map((line, index) => ({
        operationId: `local-${index + 1}`,
        kind: 'FACT_ADD' as const,
        target: { targetType: 'FACT' as const, resourceId: 'resource-1' },
        baseRevision: draft?.base.canonicalVersion ?? 1,
        rationale: 'Draft editor authoring',
        evidenceReferences: [],
        expectedImpact: { summary: line },
        operationRevision: (draft?.operations.length ?? 0) + index + 1,
        contentDigest: `sha256:${line}`,
        after: {
          schemaVersion: 'fact.v1' as const,
          subjectRef: 'editor',
          predicate: 'note',
          value: line,
        },
      }));
    controller.editOperations(operations);
  };

  const onSave = async () => {
    const result = await controller.save(client);
    if (result) {
      setEditorText(initialEditorText(result.draft));
    }
  };

  return (
    <section className="action-card" aria-labelledby="knowledge-draft-editor-heading">
      <div className="knowledge-section-heading">
        <div>
          <h2 id="knowledge-draft-editor-heading">Draft editor</h2>
          <p>Author a local draft and save it through the FE-P3-S2 coordinator.</p>
        </div>
      </div>
      <label htmlFor="knowledge-draft-editor">Draft content</label>
      <textarea
        id="knowledge-draft-editor"
        value={editorText}
        onChange={onChange}
        rows={8}
        style={{ width: '100%' }}
      />
      <div className="knowledge-tag-row">
        <button type="button" onClick={() => void onSave()}>
          Save draft
        </button>
        <span className="knowledge-tag">
          {controller.draftState.state === 'CLEAN'
            ? 'Saved'
            : controller.draftState.state === 'DIRTY' &&
                controller.draftState.localOperations.length > 0
              ? 'Edits preserved'
              : controller.draftState.state}
        </span>
      </div>
    </section>
  );
};
