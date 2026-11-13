import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { assertSurferJson, surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  decodeSurferUsage,
  SURFER_USAGE_KEYS,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  decodeSurferCognitiveRouteRequest,
  decodeSurferCognitiveValidation,
  SURFER_SEMANTIC_FIELDS,
  cognitiveFailure,
  validateSurferFrameGrounding,
  type SurferCognitiveSourcePort,
  type SurferCognitiveValidationPort,
  type SurferPlanningBudgetPort,
  type SurferPlanningBudget,
  type SurferCognitiveRoutingPolicy,
  type SurferCognitiveDecision,
  type SurferCognitiveValidation,
} from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferExecutionLedger } from './index.js';

/** Read-only/advisory. A later dispatcher must still reserve and obtain one-use execution authority. */
export class SurferLedgerPlanningBudget implements SurferPlanningBudgetPort {
  constructor(private readonly ledger: SurferExecutionLedger) {}
  async read(): Promise<SurferPlanningBudget> {
    const snapshot = await this.ledger.snapshot(),
      p = this.ledger.policy;
    return {
      status: 'AVAILABLE',
      generation: p.generation,
      allowedSpaceIds: [...p.allowedSpaceIds],
      limits: { ...p.limits },
      accounted: snapshot.accounted,
      active: snapshot.state.records.filter((r) =>
        ['DISPATCHED', 'OUTCOME_UNKNOWN'].includes(r.state),
      ).length,
      maxConcurrent: p.maxConcurrent,
      deadlineAtMs: p.deadlineAtMs,
    };
  }
}
export const unverifiedSurferCognitiveValidation: SurferCognitiveValidationPort = {
  inspect: (view, frame) => ({
    level: 'NOT_EVALUATED',
    viewDigest: view.viewDigest,
    frameDigest: surferDigest(frame),
    checkedFields: [],
    validatorRevision: 'none',
    rule: { status: 'NO_RULE', ref: null, validationRef: null, impact: 'LOW' },
  }),
};
/** Chooses a plan. Does not emit an answer, certify a model's meaning, learn a rule, or dispatch work. */
export class SurferCognitiveRouter {
  private readonly policy: SurferCognitiveRoutingPolicy;
  constructor(
    private readonly source: SurferCognitiveSourcePort,
    private readonly budget: SurferPlanningBudgetPort,
    policy: SurferCognitiveRoutingPolicy,
    private readonly validation: SurferCognitiveValidationPort = unverifiedSurferCognitiveValidation,
    private readonly clock = Date.now,
  ) {
    assertSurferJson(policy);
    if (
      !['PRODUCT', 'ISOLATED_CONTRACT'].includes(policy.mode) ||
      !policy.revision ||
      policy.revision.length > 256 ||
      !policy.audit.generation ||
      policy.audit.seed.length < 32 ||
      policy.audit.seed.length > 256 ||
      !Number.isInteger(policy.audit.rateBasisPoints) ||
      policy.audit.rateBasisPoints < 0 ||
      policy.audit.rateBasisPoints > 10000 ||
      !['BEFORE_RESPONSE', 'BACKGROUND'].includes(policy.audit.timing) ||
      !policy.audit.namespace ||
      policy.audit.namespace === policy.audit.heldoutNamespace
    )
      throw cognitiveFailure('Invalid routing/audit profile or heldout namespace overlap.');
    const local = decodeSurferUsage(policy.localMaximum),
      deep = decodeSurferUsage(policy.deepMaximum);
    if (
      local.calls ||
      local.inputTokens ||
      local.outputTokens ||
      local.moneyMicros ||
      local.elapsedMs < 1 ||
      deep.elapsedMs < 1 ||
      deep.calls < 1
    )
      throw cognitiveFailure('Routing workload bounds disagree with local/deep execution.');
    this.policy = structuredClone(policy);
  }
  async plan(
    sourceRequest: unknown,
    requestInput: unknown,
    signal?: AbortSignal,
  ): Promise<SurferCognitiveDecision> {
    const request = decodeSurferCognitiveRouteRequest(requestInput),
      p = this.policy;
    const base: Omit<SurferCognitiveDecision, 'decisionId'> = {
      schemaVersion: '1.0.0',
      operationId: request.operationId,
      path: 'SOURCE_OR_CURRENTNESS_UNAVAILABLE',
      reasons: [],
      policyRevision: p.revision,
      mode: p.mode,
      viewDigest: null,
      frameDigest: null,
      sourceReceipt: null,
      budgetGeneration: null,
      minimum: { missing: [], ambiguous: [], unmodeled: [] },
      validationLevel: 'NOT_EVALUATED',
      ruleRef: null,
      audit: {
        selected: false,
        mandatory: false,
        generation: p.audit.generation,
        seedDigest: surferDigest(p.audit.seed),
        namespace: p.audit.namespace,
        timing: p.audit.timing,
        status: 'NOT_SELECTED',
      },
      conclusionMode: 'UNRESOLVED',
      inquiry: 'NONE',
      learningScheduled: false,
      executionAuthority: 'PLAN_ONLY_NO_DISPATCH_PERMISSION',
    };
    const finish = (
      value: Omit<SurferCognitiveDecision, 'decisionId'>,
    ): SurferCognitiveDecision => ({ ...value, decisionId: surferDigest(value) });
    let budget: SurferPlanningBudget | null = null;
    try {
      const value = await this.budget.read();
      assertSurferJson(value);
      decodeSurferUsage(value.limits);
      decodeSurferUsage(value.accounted);
      if (
        value.status === 'AVAILABLE' &&
        typeof value.generation === 'string' &&
        value.generation.length > 0 &&
        value.generation.length <= 256 &&
        Array.isArray(value.allowedSpaceIds) &&
        value.allowedSpaceIds.every((x) => typeof x === 'string') &&
        Number.isSafeInteger(value.active) &&
        value.active >= 0 &&
        Number.isSafeInteger(value.maxConcurrent) &&
        value.maxConcurrent > 0 &&
        Number.isSafeInteger(value.deadlineAtMs)
      )
        budget = structuredClone(value);
    } catch {
      /* Source hard guards still run before a budget-unavailable decision. */
    }
    try {
      return await this.source.withCurrent(
        sourceRequest,
        request.basis,
        request.selections,
        (view) => {
          const d = structuredClone(base);
          d.sourceReceipt = view.readReceipt;
          d.viewDigest = view.viewDigest;
          const frame =
            request.frame === null
              ? null
              : validateSurferFrameGrounding(request.frame, view.anchors, view.viewDigest);
          d.frameDigest = frame ? surferDigest(frame) : null;
          const required = request.intent === 'SOURCE_QUOTE' ? [] : SURFER_SEMANTIC_FIELDS;
          for (const name of required) {
            const field = frame?.fields.find((f) => f.name === name);
            if (!field || field.state === 'MISSING') d.minimum.missing.push(name);
            else if (field.state === 'AMBIGUOUS') d.minimum.ambiguous.push(name);
            else if (field.state === 'UNMODELED') d.minimum.unmodeled.push(name);
          }
          let check: SurferCognitiveValidation | null = null;
          if (signal?.aborted) {
            d.path = 'YIELDED_OR_CANCELLED';
            d.reasons = ['CANCELLED'];
          } else if (request.intent === 'SOURCE_QUOTE') {
            d.path = 'DIRECT_SOURCE';
            d.reasons = ['VERBATIM_SOURCE_ONLY'];
            d.conclusionMode = 'SOURCE_QUOTE_ONLY';
          } else if (
            view.anchors.some((a) => a.normalization.state === 'UNRESOLVED') ||
            d.minimum.unmodeled.length
          ) {
            d.path = 'UNMODELED_OR_PARTIAL';
            d.reasons = ['UNRESOLVED_NORMALIZATION_OR_SEMANTIC_FIELD'];
          } else if (!frame) {
            d.path = 'DEEP_INTERPRETATION';
            d.reasons = ['MINIMUM_INTERPRETATION_NOT_YET_PROPOSED'];
          } else if (d.minimum.ambiguous.length) {
            d.path = 'DEEP_INTERPRETATION';
            d.reasons = ['AMBIGUOUS_INTERPRETATION'];
          } else if (d.minimum.missing.length) {
            d.path = 'ACTIVE_INQUIRY';
            d.reasons = ['MISSING_PREMISE'];
            d.inquiry = 'INTERNAL_SEARCH_THEN_COMPUTE_THEN_NECESSARY_USER_QUESTION';
          } else {
            try {
              const raw = this.validation.inspect(
                structuredClone(view),
                structuredClone(frame),
                request.intent,
              );
              assertSurferJson(raw);
              check = decodeSurferCognitiveValidation(raw);
            } catch {
              check = null;
            }
            if (
              !check ||
              !['NOT_EVALUATED', 'ISOLATED_FIXTURE', 'DOMAIN_VALIDATED'].includes(check.level) ||
              check.viewDigest !== view.viewDigest ||
              check.frameDigest !== d.frameDigest ||
              !Array.isArray(check.checkedFields) ||
              required.some((f) => !check!.checkedFields.includes(f)) ||
              !check.validatorRevision ||
              !check.rule ||
              !['NO_RULE', 'APPLICABLE', 'OUT_OF_SCOPE', 'CONFLICT', 'UNSUPPORTED'].includes(
                check.rule.status,
              ) ||
              !['LOW', 'HIGH'].includes(check.rule.impact)
            ) {
              d.path = 'DEEP_INTERPRETATION';
              d.reasons = ['SEMANTIC_VALIDATION_MISSING_OR_MISMATCHED'];
              check = null;
            } else {
              d.validationLevel = check.level;
              const trusted =
                check.level === 'DOMAIN_VALIDATED' ||
                (check.level === 'ISOLATED_FIXTURE' && p.mode === 'ISOLATED_CONTRACT');
              if (!trusted) {
                d.path = 'DEEP_INTERPRETATION';
                d.reasons = ['SEMANTIC_VALIDATION_LEVEL_INSUFFICIENT'];
              } else if (check.rule.status === 'CONFLICT') {
                d.path = 'DEEP_INTERPRETATION';
                d.reasons = ['RULE_CONFLICT'];
              } else if (['OUT_OF_SCOPE', 'UNSUPPORTED'].includes(check.rule.status)) {
                d.path = 'UNMODELED_OR_PARTIAL';
                d.reasons = ['RULE_NOT_APPLICABLE'];
              } else if (
                request.intent === 'RULE_QUERY' &&
                check.rule.status === 'APPLICABLE' &&
                check.rule.ref &&
                check.rule.validationRef
              ) {
                d.ruleRef = decodeSurferArtifactRef(check.rule.ref);
                d.path = 'VALIDATED_RULE_APPLY';
                d.reasons = ['TRUSTED_SCOPE_AND_RULE_CHECK'];
                d.conclusionMode = 'RULE_DERIVATION_WITH_VALIDATION';
              } else if (request.intent === 'INTERPRET') {
                d.path = 'DIRECT_SOURCE';
                d.reasons = ['CHECKED_INTERPRETATION_VERBATIM_OUTPUT_ONLY'];
                d.conclusionMode = 'SOURCE_QUOTE_ONLY';
              } else {
                d.path = 'DEEP_INTERPRETATION';
                d.reasons = ['NO_VALIDATED_APPLICABLE_RULE'];
              }
            }
          }
          const maximum = d.path === 'DEEP_INTERPRETATION' ? p.deepMaximum : p.localMaximum;
          const time = this.clock(),
            available =
              budget &&
              budget.allowedSpaceIds.includes(view.basis.authority.projectId) &&
              Number.isSafeInteger(time) &&
              time + maximum.elapsedMs <= budget.deadlineAtMs &&
              budget.active < budget.maxConcurrent &&
              SURFER_USAGE_KEYS.every(
                (k) => budget!.accounted[k] + maximum[k] <= budget!.limits[k],
              );
          d.budgetGeneration = budget?.generation ?? null;
          if (!available && d.path !== 'YIELDED_OR_CANCELLED') {
            d.path = 'YIELDED_OR_CANCELLED';
            d.reasons = ['BUDGET_DEADLINE_CONCURRENCY_OR_AUTHORITY_UNAVAILABLE'];
            d.conclusionMode = 'UNRESOLVED';
            d.ruleRef = null;
            d.inquiry = 'NONE';
          }
          if (['DIRECT_SOURCE', 'VALIDATED_RULE_APPLY'].includes(d.path)) {
            const mandatory = check?.rule.impact === 'HIGH';
            const digest = surferDigest({
              seed: p.audit.seed,
              generation: p.audit.generation,
              operationId: request.operationId,
              viewDigest: view.viewDigest,
              intent: request.intent,
            });
            const draw = parseInt(digest.slice(7, 15), 16) / 2 ** 32;
            const selected = mandatory || draw < p.audit.rateBasisPoints / 10000;
            d.audit = {
              ...d.audit,
              mandatory,
              selected,
              status: selected ? 'PENDING_INDEPENDENT_CHECK' : 'NOT_SELECTED',
            };
          }
          return finish(d);
        },
      );
    } catch (error) {
      if (error instanceof ShotgunError && error.module === 'surfer.cognition') throw error;
      const d = structuredClone(base);
      d.path =
        error instanceof ShotgunError && error.code === 'POLICY_DENIED'
          ? 'BLOCKED_ACCESS_OR_REVOKED'
          : 'SOURCE_OR_CURRENTNESS_UNAVAILABLE';
      d.reasons = [
        d.path === 'BLOCKED_ACCESS_OR_REVOKED'
          ? 'SOURCE_AUTHORITY_DENIED'
          : 'SOURCE_CURRENTNESS_OR_VALIDATION_UNAVAILABLE',
      ];
      return finish(d); // no source payload/validation text or caller-supplied authority is echoed on denial
    }
  }
}
