import { sha256Text, stableJson } from './document-evidence.js';

export const SEMANTIC_REPRESENTATION_VERSION = 'semantic-representation:v1' as const;
export const SEMANTIC_REPRESENTATION_VERSION_V2 = 'semantic-representation:v2' as const;

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

/** Deterministic UTF-16 ordinal comparison for logical semantic ordering. */
export const utf16OrdinalCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Stable JSON for semantic identities. Unlike the historical general-purpose
 * helper, this intentionally uses UTF-16 ordinal ordering and never locale
 * collation for logical digest inputs.
 */
export const semanticStableJson = (value: unknown): string => {
  const encode = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => utf16OrdinalCompare(left, right));
      return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(',')}}`;
    }
    return JSON.stringify(entry) ?? 'null';
  };
  return encode(value);
};

/**
 * Deterministically sorts unique strings using JavaScript UTF-16 code-unit lexicographical ordering.
 * This guarantees environment- and locale-independent deterministic serialization across runtimes.
 */
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

export type SemanticRepresentationV2ResourceType = Exclude<SemanticResourceType, 'FACT'>;

export type SemanticClaimInputV2 = {
  readonly resourceType: 'CLAIM';
  readonly resourceId: string;
  readonly statement: string;
  readonly subjectName?: string;
  readonly stableSubjectRef?: string;
};

export type SemanticEntityInputV2 = {
  readonly resourceType: 'ENTITY';
  readonly resourceId: string;
  readonly entityType: string;
  readonly name: string;
  readonly aliases?: readonly string[];
};

export type SemanticRelationInputV2 = {
  readonly resourceType: 'RELATION';
  readonly resourceId: string;
  readonly relationType: string;
  readonly fromName: string;
  readonly toName: string;
  readonly stableFromRef: string;
  readonly stableToRef: string;
  readonly direction?: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
};

export type SemanticEventParticipantV2 = {
  readonly name: string;
  readonly stableRef: string;
};

export type SemanticEventInputV2 = {
  readonly resourceType: 'EVENT';
  readonly resourceId: string;
  readonly eventType: string;
  readonly title: string;
  readonly subjectName?: string;
  readonly stableSubjectRef?: string;
  readonly participants?: readonly SemanticEventParticipantV2[];
  readonly occurredAt?: string;
};

export type SemanticDecisionInputV2 = {
  readonly resourceType: 'DECISION';
  readonly resourceId: string;
  readonly decisionType: string;
  readonly decision: string;
  readonly actorName?: string;
  readonly stableActorRef?: string;
};

export type SemanticRepresentationInputV2 =
  | SemanticClaimInputV2
  | SemanticEntityInputV2
  | SemanticRelationInputV2
  | SemanticEventInputV2
  | SemanticDecisionInputV2;

export type SemanticRepresentationDependency = {
  readonly resourceType: 'ENTITY';
  readonly resourceId: string;
  readonly dependencyKind: 'LABEL' | 'ALIAS_SET';
  readonly valueDigest: string;
};

export type SemanticRepresentationV2 = {
  readonly resourceType: SemanticRepresentationV2ResourceType;
  readonly resourceId: string;
  readonly representationVersion: typeof SEMANTIC_REPRESENTATION_VERSION_V2;
  readonly semanticText: string;
  readonly semanticTextDigest: string;
  readonly dependencies: readonly SemanticRepresentationDependency[];
};

const dependency = (
  resourceId: string,
  dependencyKind: SemanticRepresentationDependency['dependencyKind'],
  value: unknown,
): SemanticRepresentationDependency => ({
  resourceType: 'ENTITY',
  resourceId: normalizeText(resourceId),
  dependencyKind,
  valueDigest: sha256Text(semanticStableJson(value)),
});

const sortDependencies = (
  values: readonly SemanticRepresentationDependency[],
): readonly SemanticRepresentationDependency[] =>
  Object.freeze(
    [...values].sort(
      (left, right) =>
        utf16OrdinalCompare(left.resourceId, right.resourceId) ||
        utf16OrdinalCompare(left.dependencyKind, right.dependencyKind) ||
        utf16OrdinalCompare(left.valueDigest, right.valueDigest),
    ),
  );

const sortParticipants = (
  values: readonly SemanticEventParticipantV2[] | undefined,
): readonly SemanticEventParticipantV2[] =>
  Object.freeze(
    [...(values ?? [])]
      .map((value) => ({
        name: normalizeText(value.name),
        stableRef: normalizeText(value.stableRef),
      }))
      .filter((value) => value.stableRef || value.name)
      .sort(
        (left, right) =>
          utf16OrdinalCompare(left.stableRef, right.stableRef) ||
          utf16OrdinalCompare(left.name, right.name),
      ),
  );

export class SemanticRepresentationBuilderV2 {
  readonly representationVersion = SEMANTIC_REPRESENTATION_VERSION_V2;

  build(input: SemanticRepresentationInputV2): SemanticRepresentationV2 {
    switch (input.resourceType) {
      case 'CLAIM':
        return this.buildClaim(input);
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
          `Unsupported semantic representation v2 resource type: ${(exhaustive as { readonly resourceType?: string }).resourceType}`,
        );
      }
    }
  }

  buildClaim(input: SemanticClaimInputV2): SemanticRepresentationV2 {
    const resourceId = normalizeText(input.resourceId);
    const statement = normalizeText(input.statement);
    const subjectName = normalizeText(input.subjectName);
    const stableSubjectRef = normalizeText(input.stableSubjectRef);
    const lines = ['resource_type: CLAIM', `statement: ${statement}`];
    if (subjectName) lines.push(`subject_name: ${subjectName}`);
    if (stableSubjectRef) lines.push(`stable_subject_ref: ${stableSubjectRef}`);
    return this.finish('CLAIM', resourceId, lines.join('\n'), []);
  }

  buildEntity(input: SemanticEntityInputV2): SemanticRepresentationV2 {
    const resourceId = normalizeText(input.resourceId);
    const entityType = normalizeText(input.entityType);
    const name = normalizeText(input.name);
    const aliases = sortedUnique(input.aliases);
    const lines = ['resource_type: ENTITY', `entity_type: ${entityType}`, `name: ${name}`];
    if (aliases.length > 0) lines.push(`aliases: ${aliases.join(', ')}`);
    return this.finish('ENTITY', resourceId, lines.join('\n'), [
      dependency(resourceId, 'ALIAS_SET', { name, aliases }),
    ]);
  }

  buildRelation(input: SemanticRelationInputV2): SemanticRepresentationV2 {
    const resourceId = normalizeText(input.resourceId);
    const relationType = normalizeText(input.relationType);
    const fromName = normalizeText(input.fromName) || normalizeText(input.stableFromRef);
    const toName = normalizeText(input.toName) || normalizeText(input.stableToRef);
    const stableFromRef = normalizeText(input.stableFromRef);
    const stableToRef = normalizeText(input.stableToRef);
    const lines = [
      'resource_type: RELATION',
      `relation_type: ${relationType}`,
      `from_name: ${fromName}`,
      `to_name: ${toName}`,
      `stable_from_ref: ${stableFromRef}`,
      `stable_to_ref: ${stableToRef}`,
      `direction: ${input.direction ?? 'DIRECTED'}`,
    ];
    const validFrom = normalizeText(input.validFrom);
    const validTo = normalizeText(input.validTo);
    if (validFrom) lines.push(`valid_from: ${validFrom}`);
    if (validTo) lines.push(`valid_to: ${validTo}`);
    return this.finish('RELATION', resourceId, lines.join('\n'), [
      dependency(stableFromRef, 'LABEL', { name: fromName }),
      dependency(stableToRef, 'LABEL', { name: toName }),
    ]);
  }

  buildEvent(input: SemanticEventInputV2): SemanticRepresentationV2 {
    const resourceId = normalizeText(input.resourceId);
    const lines = [
      'resource_type: EVENT',
      `event_type: ${normalizeText(input.eventType)}`,
      `title: ${normalizeText(input.title)}`,
    ];
    const subjectName = normalizeText(input.subjectName);
    const stableSubjectRef = normalizeText(input.stableSubjectRef);
    if (subjectName) lines.push(`subject_name: ${subjectName}`);
    if (stableSubjectRef) lines.push(`stable_subject_ref: ${stableSubjectRef}`);
    const participants = sortParticipants(input.participants);
    if (participants.length > 0) {
      lines.push(`participant_names: ${participants.map((value) => value.name).join(', ')}`);
      lines.push(
        `stable_participant_refs: ${participants.map((value) => value.stableRef).join(', ')}`,
      );
    }
    const occurredAt = normalizeText(input.occurredAt);
    if (occurredAt) lines.push(`occurred_at: ${occurredAt}`);
    const dependencies = [
      ...(stableSubjectRef
        ? [dependency(stableSubjectRef, 'LABEL', { name: subjectName || stableSubjectRef })]
        : []),
      ...participants.map((value) =>
        dependency(value.stableRef, 'LABEL', { name: value.name || value.stableRef }),
      ),
    ];
    return this.finish('EVENT', resourceId, lines.join('\n'), dependencies);
  }

  buildDecision(input: SemanticDecisionInputV2): SemanticRepresentationV2 {
    const resourceId = normalizeText(input.resourceId);
    const lines = [
      'resource_type: DECISION',
      `decision_type: ${normalizeText(input.decisionType)}`,
      `decision: ${normalizeText(input.decision)}`,
    ];
    const actorName = normalizeText(input.actorName);
    const stableActorRef = normalizeText(input.stableActorRef);
    if (actorName) lines.push(`actor_name: ${actorName}`);
    if (stableActorRef) lines.push(`stable_actor_ref: ${stableActorRef}`);
    return this.finish(
      'DECISION',
      resourceId,
      lines.join('\n'),
      stableActorRef
        ? [dependency(stableActorRef, 'LABEL', { name: actorName || stableActorRef })]
        : [],
    );
  }

  private finish(
    resourceType: SemanticRepresentationV2ResourceType,
    resourceId: string,
    semanticText: string,
    dependencies: readonly SemanticRepresentationDependency[],
  ): SemanticRepresentationV2 {
    const orderedDependencies = sortDependencies(dependencies);
    return {
      resourceType,
      resourceId,
      representationVersion: this.representationVersion,
      semanticText,
      semanticTextDigest: sha256Text(
        semanticStableJson({
          version: this.representationVersion,
          resourceType,
          semanticText,
          dependencies: orderedDependencies,
        }),
      ),
      dependencies: orderedDependencies,
    };
  }
}

export const semanticRepresentationBuilderV2 = new SemanticRepresentationBuilderV2();
