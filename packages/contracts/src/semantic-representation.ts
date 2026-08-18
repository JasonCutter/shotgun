import { sha256Text, stableJson } from './document-evidence.js';

export const SEMANTIC_REPRESENTATION_VERSION = 'semantic-representation:v1' as const;

export type SemanticResourceType = 'CLAIM' | 'FACT' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION';

export type SemanticClaimInput = {
  readonly resourceType: 'CLAIM';
  readonly resourceId: string;
  readonly statement: string;
  readonly subjectRef?: string;
};

export type SemanticFactInput = {
  readonly resourceType: 'FACT';
  readonly resourceId: string;
  readonly subjectRef: string;
  readonly predicate: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
};

export type SemanticEntityInput = {
  readonly resourceType: 'ENTITY';
  readonly resourceId: string;
  readonly entityType: string;
  readonly displayName: string;
  readonly aliases?: readonly string[];
};

export type SemanticRelationInput = {
  readonly resourceType: 'RELATION';
  readonly resourceId: string;
  readonly relationType: string;
  readonly fromEntityRef: string;
  readonly toEntityRef: string;
  readonly direction?: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
};

export type SemanticEventInput = {
  readonly resourceType: 'EVENT';
  readonly resourceId: string;
  readonly eventType: string;
  readonly title: string;
  readonly subjectRef?: string;
  readonly participantRefs?: readonly string[];
  readonly occurredAt?: string;
};

export type SemanticDecisionInput = {
  readonly resourceType: 'DECISION';
  readonly resourceId: string;
  readonly decisionType: string;
  readonly decision: string;
  readonly actorRef?: string;
};

export type SemanticResourceInput =
  | SemanticClaimInput
  | SemanticFactInput
  | SemanticEntityInput
  | SemanticRelationInput
  | SemanticEventInput
  | SemanticDecisionInput;

export type SemanticRepresentation = {
  readonly resourceType: SemanticResourceType;
  readonly resourceId: string;
  readonly representationVersion: typeof SEMANTIC_REPRESENTATION_VERSION;
  readonly semanticText: string;
  readonly semanticTextDigest: string;
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? '';

const sortedUnique = (items: readonly string[] | undefined): readonly string[] => {
  if (!items || items.length === 0) return [];
  const set = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed) set.add(trimmed);
  }
  return Object.freeze([...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
};

export class SemanticRepresentationBuilder {
  readonly representationVersion = SEMANTIC_REPRESENTATION_VERSION;

  build(input: SemanticResourceInput): SemanticRepresentation {
    switch (input.resourceType) {
      case 'CLAIM':
        return this.buildClaim(input);
      case 'FACT':
        return this.buildFact(input);
      case 'ENTITY':
        return this.buildEntity(input);
      case 'RELATION':
        return this.buildRelation(input);
      case 'EVENT':
        return this.buildEvent(input);
      case 'DECISION':
        return this.buildDecision(input);
      default: {
        const exhaustive: never = input;
        throw new Error(
          `Unsupported semantic resource type: ${(exhaustive as { readonly resourceType?: string }).resourceType}`,
        );
      }
    }
  }

  buildClaim(input: SemanticClaimInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const statement = normalizeText(input.statement);
    const subjectRef = normalizeText(input.subjectRef);

    const lines: string[] = ['resource_type: CLAIM', `statement: ${statement}`];
    if (subjectRef) lines.push(`subject_ref: ${subjectRef}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'CLAIM',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('CLAIM', semanticText),
    };
  }

  buildFact(input: SemanticFactInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const subjectRef = normalizeText(input.subjectRef);
    const predicate = normalizeText(input.predicate);
    const value = typeof input.value === 'string' ? input.value.trim() : String(input.value);
    const unit = normalizeText(input.unit);

    const lines: string[] = [
      'resource_type: FACT',
      `subject_ref: ${subjectRef}`,
      `predicate: ${predicate}`,
      `value: ${value}`,
    ];
    if (unit) lines.push(`unit: ${unit}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'FACT',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('FACT', semanticText),
    };
  }

  buildEntity(input: SemanticEntityInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const entityType = normalizeText(input.entityType);
    const displayName = normalizeText(input.displayName);
    const aliases = sortedUnique(input.aliases);

    const lines: string[] = [
      'resource_type: ENTITY',
      `entity_type: ${entityType}`,
      `name: ${displayName}`,
    ];
    if (aliases.length > 0) lines.push(`aliases: ${aliases.join(', ')}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'ENTITY',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('ENTITY', semanticText),
    };
  }

  buildRelation(input: SemanticRelationInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const relationType = normalizeText(input.relationType);
    const fromEntityRef = normalizeText(input.fromEntityRef);
    const toEntityRef = normalizeText(input.toEntityRef);
    const direction = input.direction ?? 'DIRECTED';
    const validFrom = normalizeText(input.validFrom);
    const validTo = normalizeText(input.validTo);

    const lines: string[] = [
      'resource_type: RELATION',
      `relation_type: ${relationType}`,
      `from: ${fromEntityRef}`,
      `to: ${toEntityRef}`,
      `direction: ${direction}`,
    ];
    if (validFrom) lines.push(`valid_from: ${validFrom}`);
    if (validTo) lines.push(`valid_to: ${validTo}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'RELATION',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('RELATION', semanticText),
    };
  }

  buildEvent(input: SemanticEventInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const eventType = normalizeText(input.eventType);
    const title = normalizeText(input.title);
    const subjectRef = normalizeText(input.subjectRef);
    const participantRefs = sortedUnique(input.participantRefs);
    const occurredAt = normalizeText(input.occurredAt);

    const lines: string[] = ['resource_type: EVENT', `event_type: ${eventType}`, `title: ${title}`];
    if (subjectRef) lines.push(`subject_ref: ${subjectRef}`);
    if (participantRefs.length > 0) lines.push(`participants: ${participantRefs.join(', ')}`);
    if (occurredAt) lines.push(`occurred_at: ${occurredAt}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'EVENT',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('EVENT', semanticText),
    };
  }

  buildDecision(input: SemanticDecisionInput): SemanticRepresentation {
    const resourceId = normalizeText(input.resourceId);
    const decisionType = normalizeText(input.decisionType);
    const decision = normalizeText(input.decision);
    const actorRef = normalizeText(input.actorRef);

    const lines: string[] = [
      'resource_type: DECISION',
      `decision_type: ${decisionType}`,
      `decision: ${decision}`,
    ];
    if (actorRef) lines.push(`actor_ref: ${actorRef}`);

    const semanticText = lines.join('\n');
    return {
      resourceType: 'DECISION',
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: this.computeDigest('DECISION', semanticText),
    };
  }

  private computeDigest(resourceType: SemanticResourceType, semanticText: string): string {
    return sha256Text(
      stableJson({
        version: this.representationVersion,
        resourceType,
        semanticText,
      }),
    );
  }
}

export const semanticRepresentationBuilder = new SemanticRepresentationBuilder();
