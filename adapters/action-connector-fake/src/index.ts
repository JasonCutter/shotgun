import type {
  ActionPreview,
  ActionVerification,
  ProviderActionResult,
} from '../../../packages/contracts/src/index.js';
import { sha256Text, stableJson, ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  ActionConnectorPort,
  ActionPreflightResult,
} from '../../../modules/action-execution/src/index.js';

export type FakeActionBehavior = {
  readonly preflight: 'ready' | 'deny';
  readonly execute:
    'success' | 'definite-failure' | 'unknown-before-effect' | 'unknown-after-effect';
};

const defaultBehavior: FakeActionBehavior = { preflight: 'ready', execute: 'success' };

export class FakeDraftActionConnector implements ActionConnectorPort {
  readonly identity = {
    id: 'fake-draft',
    version: '1.0.0',
    provider: 'fake',
    secretBoundary: 'ADAPTER_INTERNAL' as const,
  };
  readonly calls = { preflight: 0, execute: 0, verify: 0 };

  #secret: string;
  #behavior: FakeActionBehavior;
  #effects = new Map<string, ProviderActionResult>();

  constructor(secret = 'fake-connector-secret', behavior: FakeActionBehavior = defaultBehavior) {
    this.#secret = secret;
    this.#behavior = behavior;
  }

  setBehavior(behavior: FakeActionBehavior): void {
    this.#behavior = behavior;
  }

  async preflight(preview: ActionPreview, idempotencyKey: string): Promise<ActionPreflightResult> {
    this.calls.preflight += 1;
    if (!this.#secret || preview.candidate.target.connectorId !== this.identity.id) {
      return { status: 'DENIED', reason: 'Connector credential or target is unavailable.' };
    }
    if (preview.candidate.operation !== 'CREATE_DRAFT') {
      return {
        status: 'DENIED',
        reason: 'The Stage 11 fake connector only supports CREATE_DRAFT.',
      };
    }
    const existing = this.#effects.get(idempotencyKey);
    if (existing) return { status: 'ALREADY_APPLIED', providerResult: existing };
    return this.#behavior.preflight === 'deny'
      ? { status: 'DENIED', reason: 'Fake provider denied the current target state.' }
      : { status: 'READY' };
  }

  async execute(preview: ActionPreview, idempotencyKey: string): Promise<ProviderActionResult> {
    this.calls.execute += 1;
    const existing = this.#effects.get(idempotencyKey);
    if (existing) return existing;
    if (this.#behavior.execute === 'definite-failure') {
      throw new ShotgunError({
        code: 'TERMINAL_FAILURE',
        safeMessage: 'Fake provider rejected the draft before applying it.',
        module: 'fake-draft-action-connector',
        operation: 'execute',
      });
    }
    if (this.#behavior.execute === 'unknown-before-effect') throw outcomeUnknown();

    const completedAt = new Date().toISOString();
    const observedDigest = sha256Text(
      stableJson({ target: preview.candidate.target, parameters: preview.candidate.parameters }),
    );
    const result: ProviderActionResult = {
      provider: this.identity.provider,
      externalId: `fake-draft:${sha256Text(idempotencyKey).slice(-16)}`,
      idempotencyKey,
      observedDigest,
      completedAt,
    };
    this.#effects.set(idempotencyKey, result);
    if (this.#behavior.execute === 'unknown-after-effect') throw outcomeUnknown();
    return result;
  }

  async verify(
    _preview: ActionPreview,
    idempotencyKey: string,
    providerResult?: ProviderActionResult,
  ): Promise<Omit<ActionVerification, 'verifiedAt'>> {
    this.calls.verify += 1;
    const effect = this.#effects.get(idempotencyKey);
    if (!effect) return { status: 'NOT_APPLIED', provider: this.identity.provider };
    if (providerResult && providerResult.observedDigest !== effect.observedDigest) {
      return {
        status: 'MISMATCH',
        provider: this.identity.provider,
        observedDigest: effect.observedDigest,
      };
    }
    return {
      status: 'APPLIED',
      provider: this.identity.provider,
      observedDigest: effect.observedDigest,
    };
  }
}

const outcomeUnknown = (): ShotgunError =>
  new ShotgunError({
    code: 'OUTCOME_UNKNOWN',
    safeMessage: 'Fake provider response was lost and the final outcome is unknown.',
    module: 'fake-draft-action-connector',
    operation: 'execute',
  });
