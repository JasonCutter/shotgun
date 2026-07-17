import { randomUUID } from 'node:crypto';

import type {
  ActionApprovalRecord,
  ActionAuditEvent,
  ActionExecutionRecord,
  ServerActionCandidate,
} from '../../../packages/contracts/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  ActionCandidateRepositoryPort,
  ActionExecutionRepositoryPort,
  ActionTransition,
} from '../../../modules/action-execution/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);
const candidateKey = (record: ActionExecutionRecord): string =>
  `${record.projectId}:${record.preview.candidate.candidateId}:${record.preview.candidate.revisionNumber}:${record.preview.operationKey}`;

export class InMemoryActionCandidateRepository implements ActionCandidateRepositoryPort {
  private readonly candidates = new Map<string, ServerActionCandidate>();

  async stage(candidate: ServerActionCandidate): Promise<void> {
    this.candidates.set(
      `${candidate.projectId}:${candidate.candidate.candidateId}`,
      clone(candidate),
    );
  }

  async find(projectId: string, candidateId: string): Promise<ServerActionCandidate | undefined> {
    const candidate = this.candidates.get(`${projectId}:${candidateId}`);
    return candidate ? clone(candidate) : undefined;
  }
}

export class InMemoryActionExecutionRepository implements ActionExecutionRepositoryPort {
  private readonly records = new Map<string, ActionExecutionRecord>();
  private readonly candidateIndex = new Map<string, string>();
  private readonly approvalIndex = new Map<string, string>();
  private readonly auditEvents = new Map<string, ActionAuditEvent[]>();

  async createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord> {
    const key = candidateKey(record);
    const existingId = this.candidateIndex.get(key);
    if (existingId) {
      const existing = this.records.get(existingId)!;
      if (existing.preview.previewDigest !== record.preview.previewDigest)
        throw stale('The same Action Candidate revision was changed after Preview creation.');
      return clone(existing);
    }
    this.records.set(record.actionId, clone(record));
    this.candidateIndex.set(key, record.actionId);
    for (const event of initialAudit) this.append(event);
    return clone(record);
  }

  async approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalRecord,
  ): Promise<ActionExecutionRecord> {
    const current = this.require(projectId, actionId);
    if (current.status === 'APPROVED' && current.approval) return clone(current);
    if (
      current.status !== 'PREVIEW_READY' ||
      expectedPreviewDigest !== current.preview.previewDigest ||
      approval.snapshotDigest !== current.preview.previewDigest ||
      approval.snapshotId !== current.preview.snapshotId ||
      approval.expiresAt !== current.preview.expiresAt
    )
      throw stale('Preview Snapshot does not match the Action approval.');
    const next: ActionExecutionRecord = {
      ...current,
      status: 'APPROVED',
      approval,
      updatedAt: approval.approvedAt,
    };
    this.records.set(actionId, clone(next));
    this.approvalIndex.set(approval.approvalId, actionId);
    this.append({
      actionId,
      projectId,
      category: 'ACTION_APPROVED',
      actorId: approval.approvedBy.id,
      policyVersion: current.preview.riskDecision.policyVersion,
      details: {
        approvalId: approval.approvalId,
        snapshotDigest: approval.snapshotDigest,
        candidateRevision: approval.candidateRevision,
        expiresAt: approval.expiresAt,
      },
      occurredAt: approval.approvedAt,
    });
    return clone(next);
  }

  async claimForExecution(
    projectId: string,
    approvalId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }> {
    const actionId = this.approvalIndex.get(approvalId);
    if (!actionId) throw stale('Approval Record is invalid.');
    const current = this.require(projectId, actionId);
    const approval = current.approval;
    if (
      !approval ||
      approval.approvalId !== approvalId ||
      approval.snapshotDigest !== current.preview.previewDigest ||
      approval.snapshotId !== current.preview.snapshotId
    )
      throw stale('Approval Record does not match the immutable Preview Snapshot.');
    if (current.status !== 'APPROVED') return { claimed: false, record: clone(current) };
    if (new Date(approval.expiresAt).getTime() <= new Date(now).getTime())
      throw stale('Approval Record has expired.');
    const next: ActionExecutionRecord = { ...current, status: 'EXECUTING', updatedAt: now };
    this.records.set(actionId, clone(next));
    this.append({
      actionId,
      projectId,
      category: 'ACTION_EXECUTION_CLAIMED',
      actorId,
      policyVersion: current.preview.riskDecision.policyVersion,
      details: { approvalId, snapshotDigest: approval.snapshotDigest, automaticRetry: false },
      occurredAt: now,
    });
    return { claimed: true, record: clone(next) };
  }

  async transition(
    projectId: string,
    actionId: string,
    transition: ActionTransition,
  ): Promise<ActionExecutionRecord> {
    const current = this.require(projectId, actionId);
    if (current.status !== transition.expectedStatus)
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Action '${actionId}' moved from ${transition.expectedStatus} to ${current.status}.`,
        module: 'stage11-in-memory',
        operation: 'transition-action',
      });
    if (
      transition.next.actionId !== current.actionId ||
      transition.next.projectId !== current.projectId ||
      transition.next.preview.previewDigest !== current.preview.previewDigest
    )
      throw stale('An Action transition cannot change immutable Preview Snapshot identity.');
    this.records.set(actionId, clone(transition.next));
    this.append({
      actionId,
      projectId,
      category: transition.category,
      actorId: transition.actorId,
      policyVersion: current.preview.riskDecision.policyVersion,
      details: transition.details,
      occurredAt: transition.next.updatedAt,
    });
    return clone(transition.next);
  }

  async find(projectId: string, actionId: string): Promise<ActionExecutionRecord | undefined> {
    const record = this.records.get(actionId);
    return record?.projectId === projectId ? clone(record) : undefined;
  }

  async listAudit(projectId: string, actionId: string): Promise<readonly ActionAuditEvent[]> {
    const record = this.records.get(actionId);
    return !record || record.projectId !== projectId
      ? []
      : clone(this.auditEvents.get(actionId) ?? []);
  }

  private require(projectId: string, actionId: string): ActionExecutionRecord {
    const record = this.records.get(actionId);
    if (!record || record.projectId !== projectId)
      throw new ShotgunError({
        code: 'ACTION_REFERENCE_NOT_FOUND',
        safeMessage: `Action '${actionId}' was not found in this project.`,
        module: 'stage11-in-memory',
        operation: 'find-action',
      });
    return record;
  }

  private append(event: Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>): void {
    const events = this.auditEvents.get(event.actionId) ?? [];
    events.push({ ...event, auditEventId: randomUUID(), sequence: events.length + 1 });
    this.auditEvents.set(event.actionId, events);
  }
}

const stale = (message: string): ShotgunError =>
  new ShotgunError({
    code: 'STALE_ACTION_SNAPSHOT',
    safeMessage: message,
    module: 'stage11-in-memory',
    operation: 'validate-action-approval',
  });
