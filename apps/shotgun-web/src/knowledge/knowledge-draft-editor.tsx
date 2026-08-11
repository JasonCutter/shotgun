import { useEffect, useState, type ChangeEvent } from 'react';
import { useKnowledgeDraft } from './knowledge-draft-controller.js';
import type {
  FrontendKnowledgeDraftChangeSetV1,
  FrontendKnowledgeDraftClient,
  FrontendKnowledgeOperationV1,
} from '@shotgun/api-client';

export type KnowledgeDraftEditorProps = {
  readonly draft: FrontendKnowledgeDraftChangeSetV1 | null | undefined;
  readonly activeProjectId?: string;
  readonly sessionId?: string;
  readonly client: Pick<FrontendKnowledgeDraftClient, 'saveDraft'>;
};

const operationText = (operation: FrontendKnowledgeOperationV1): string => {
  if (!('after' in operation) || !operation.after) return '';
  const after = operation.after;
  switch (after.schemaVersion) {
    case 'claim.v1':
      return after.statement;
    case 'fact.v1':
      return String(after.value);
    case 'entity.v1':
      return after.displayName;
    case 'relation.v1':
      return `${after.relationType}: ${after.fromEntityRef} -> ${after.toEntityRef}`;
    case 'event.v1':
      return after.eventType;
    case 'decision.v1':
      return after.decision;
    case 'evidence-link.v1':
      return 'Evidence link';
    case 'temporal-validity.v1':
      return after.status;
    case 'conflict-proposal.v1':
      return after.summary;
    case 'knowledge-gap-proposal.v1':
      return after.description;
    case 'no-op-review-result.v1':
      return after.reason;
  }
};

const draftStateLabel = (state: string): string => {
  const labels: Readonly<Record<string, string>> = {
    CLEAN: 'Saved',
    DIRTY: 'Edits preserved',
    SAVING: 'Saving',
    SAVE_FAILED: 'Save failed',
    STALE: 'Draft changed; refresh required',
  };
  return labels[state] ?? 'Draft status unavailable';
};

const initialEditorText = (draft: FrontendKnowledgeDraftChangeSetV1 | null | undefined) => {
  if (!draft) return '';
  return draft.operations.map(operationText).join('\n');
};

export const KnowledgeDraftEditor = ({
  draft,
  activeProjectId,
  sessionId,
  client,
}: KnowledgeDraftEditorProps) => {
  const controller = useKnowledgeDraft(draft, activeProjectId, sessionId);
  const [editorText, setEditorText] = useState(() => initialEditorText(draft));

  useEffect(() => {
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
        <span className="knowledge-tag">{draftStateLabel(controller.draftState.state)}</span>
      </div>
    </section>
  );
};
