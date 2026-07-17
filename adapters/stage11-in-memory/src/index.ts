import { randomUUID } from 'node:crypto';

import type {
  ActionApprovalToken,
  ActionAuditEvent,
  ActionExecutionRecord,
} from '../../../packages/contracts/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  ActionExecutionRepositoryPort,
  ActionTransition,
} from '../../../modules/action-execution/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);
const candidateKey = (record: ActionExecutionRecord): string =>
  `${record.projectId}:${record.preview.candidate.candidateId}:${record.preview.candidate.revisionNumber}`;

export class InMemoryActionExecutionRepository implements ActionExecutionRepositoryPort {
  private readonly records = new Map<string, ActionExecutionRecord>();
  private readonly candidateIndex = new Map<string, string>();
  private readonly auditEvents = new Map<string, ActionAuditEvent[]>();

  async createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord> {
    const key = candidateKey(record);
    const existingId = this.candidateIndex.get(key);
    if (existingId) {
      const existing = this.records.get(existingId)!;
      if (existing.preview.candidateDigest !== record.preview.candidateDigest) {
        throw stale('The same Action candidate revision was changed after preview creation.');
      }
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
    approval: ActionApprovalToken,
  ): Promise<ActionExecutionRecord> {
    const current = this.require(projectId, actionId);
    if (current.status === 'APPROVED' && current.approval) return clone(current);
    if (current.status !== 'PREVIEW_READY') {
      throw stale(`Action '${actionId}' is no longer waiting for approval.`);
    }
    if (
      expectedPreviewDigest !== current.preview.previewDigest ||
      approval.previewDigest !== current.preview.previewDigest ||
      approval.candidateRevision !== current.preview.candidate.revisionNumber ||
      approval.targetDigest !== current.preview.targetDigest ||
      approval.parameterDigest !== current.preview.parameterDigest
    ) {
      throw stale('The Action changed after the displayed Preview was created.');
    }
    const next: ActionExecutionRecord = {
      ...current,
      status: 'APPROVED',
      approval,
      updatedAt: approval.approvedAt,
    };
    this.records.set(actionId, clone(next));
    this.append({
      actionId,
      projectId,
      category: 'ACTION_APPROVED',
      actorId: approval.approvedBy.id,
      policyVersion: current.preview.riskDecision.policyVersion,
      details: {
        tokenId: approval.tokenId,
        previewDigest: approval.previewDigest,
        candidateRevision: approval.candidateRevision,
        expiresAt: approval.expiresAt,
      },
      occurredAt: approval.approvedAt,
    });
    return clone(next);
  }

  async claimForExecution(
    projectId: string,
    actionId: string,
    tokenId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }> {
    const current = this.require(projectId, actionId);
    const approval = current.approval;
    if (!approval || approval.tokenId !== tokenId) throw stale('Approval Token is invalid.');
    if (
      approval.previewDigest !== current.preview.previewDigest ||
      approval.targetDigest !== current.preview.targetDigest ||
      approval.parameterDigest !== current.preview.parameterDigest ||
      approval.candidateRevision !== current.preview.candidate.revisionNumber
    ) {
      throw stale('Approval Token does not match the current Action revision and parameters.');
    }
    if (current.status !== 'APPROVED') return { claimed: false, record: clone(current) };
    if (new Date(approval.expiresAt).getTime() <= new Date(now).getTime()) {
      throw stale('Approval Token has expired.');
    }
    const next: ActionExecutionRecord = { ...current, status: 'EXECUTING', updatedAt: now };
    this.records.set(actionId, clone(next));
    this.append({
      actionId,
      projectId,
      category: 'ACTION_EXECUTION_CLAIMED',
      actorId,
      policyVersion: current.preview.riskDecision.policyVersion,
      details: { tokenId, automaticRetry: false },
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
    if (current.status !== transition.expectedStatus) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Action '${actionId}' moved from ${transition.expectedStatus} to ${current.status}.`,
        module: 'stage11-in-memory',
        operation: 'transition-action',
      });
    }
    if (
      transition.next.actionId !== current.actionId ||
      transition.next.projectId !== current.projectId ||
      transition.next.preview.previewDigest !== current.preview.previewDigest
    ) {
      throw stale('An Action transition cannot change the approved Preview identity.');
    }
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
    if (!record || record.projectId !== projectId) return [];
    return clone(this.auditEvents.get(actionId) ?? []);
  }

  private require(projectId: string, actionId: string): ActionExecutionRecord {
    const record = this.records.get(actionId);
    if (!record || record.projectId !== projectId) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Action '${actionId}' was not found in this project.`,
        module: 'stage11-in-memory',
        operation: 'find-action',
      });
    }
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
    code: 'STALE_APPROVAL',
    safeMessage: message,
    module: 'stage11-in-memory',
    operation: 'validate-action-approval',
  });
