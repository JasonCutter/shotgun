import { describe, expect, it } from 'vitest';

import {
  SEMANTIC_REPRESENTATION_VERSION,
  SemanticRepresentationBuilder,
  semanticRepresentationBuilder,
  type SemanticClaimInput,
  type SemanticDecisionInput,
  type SemanticEntityInput,
  type SemanticEventInput,
  type SemanticFactInput,
  type SemanticRelationInput,
} from '../../packages/contracts/src/index.js';

describe('AKP-1 WP1: SemanticRepresentationBuilder', () => {
  it('builds byte-stable deterministic representation for Claim', () => {
    const input: SemanticClaimInput = {
      resourceType: 'CLAIM',
      resourceId: 'claim-101',
      statement: 'PostgreSQL provides robust transactional semantics.',
      subjectRef: 'entity-postgresql',
    };

    const customBuilder = new SemanticRepresentationBuilder();
    const rep1 = customBuilder.build(input);
    const rep2 = semanticRepresentationBuilder.buildClaim(input);

    expect(rep1).toEqual(rep2);
    expect(rep1.resourceType).toBe('CLAIM');
    expect(rep1.resourceId).toBe('claim-101');
    expect(rep1.representationVersion).toBe(SEMANTIC_REPRESENTATION_VERSION);
    expect(rep1.semanticText).toBe(
      'resource_type: CLAIM\nstatement: PostgreSQL provides robust transactional semantics.\nsubject_ref: entity-postgresql',
    );
    expect(rep1.semanticTextDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Verify byte-stability on multiple calls
    const rep3 = semanticRepresentationBuilder.build(input);
    expect(rep3.semanticText).toBe(rep1.semanticText);
    expect(rep3.semanticTextDigest).toBe(rep1.semanticTextDigest);
  });

  it('builds byte-stable deterministic representation for Fact', () => {
    const input: SemanticFactInput = {
      resourceType: 'FACT',
      resourceId: 'fact-201',
      subjectRef: 'entity-database',
      predicate: 'max_connections',
      value: 100,
      unit: 'connections',
    };

    const rep = semanticRepresentationBuilder.build(input);
    expect(rep.resourceType).toBe('FACT');
    expect(rep.resourceId).toBe('fact-201');
    expect(rep.semanticText).toBe(
      'resource_type: FACT\nsubject_ref: entity-database\npredicate: max_connections\nvalue: 100\nunit: connections',
    );
    expect(rep.semanticTextDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('builds byte-stable deterministic representation for Entity with sorted aliases', () => {
    const input1: SemanticEntityInput = {
      resourceType: 'ENTITY',
      resourceId: 'entity-301',
      entityType: 'ORGANIZATION',
      displayName: 'Shotgun AI Project',
      aliases: ['Shotgun', 'AGY Shotgun', 'Shotgun Project'],
    };

    const input2: SemanticEntityInput = {
      resourceType: 'ENTITY',
      resourceId: 'entity-301',
      entityType: 'ORGANIZATION',
      displayName: 'Shotgun AI Project',
      aliases: ['Shotgun Project', 'Shotgun', 'AGY Shotgun'], // different order
    };

    const rep1 = semanticRepresentationBuilder.build(input1);
    const rep2 = semanticRepresentationBuilder.build(input2);

    expect(rep1.semanticText).toBe(rep2.semanticText);
    expect(rep1.semanticTextDigest).toBe(rep2.semanticTextDigest);
    expect(rep1.semanticText).toBe(
      'resource_type: ENTITY\nentity_type: ORGANIZATION\nname: Shotgun AI Project\naliases: AGY Shotgun, Shotgun, Shotgun Project',
    );
  });

  it('builds byte-stable deterministic representation for Relation', () => {
    const input: SemanticRelationInput = {
      resourceType: 'RELATION',
      resourceId: 'rel-401',
      relationType: 'DEPENDS_ON',
      fromEntityRef: 'entity-service-a',
      toEntityRef: 'entity-database-b',
      direction: 'DIRECTED',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    };

    const rep = semanticRepresentationBuilder.build(input);
    expect(rep.resourceType).toBe('RELATION');
    expect(rep.resourceId).toBe('rel-401');
    expect(rep.semanticText).toBe(
      'resource_type: RELATION\nrelation_type: DEPENDS_ON\nfrom: entity-service-a\nto: entity-database-b\ndirection: DIRECTED\nvalid_from: 2026-01-01\nvalid_to: 2026-12-31',
    );
    expect(rep.semanticTextDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('builds byte-stable deterministic representation for Event with sorted participants', () => {
    const input: SemanticEventInput = {
      resourceType: 'EVENT',
      resourceId: 'event-501',
      eventType: 'SYSTEM_UPGRADE',
      title: 'PostgreSQL 16 Engine Upgrade',
      subjectRef: 'entity-postgresql',
      participantRefs: ['actor-bob', 'actor-alice'],
      occurredAt: '2026-08-18T10:00:00Z',
    };

    const rep = semanticRepresentationBuilder.build(input);
    expect(rep.resourceType).toBe('EVENT');
    expect(rep.resourceId).toBe('event-501');
    expect(rep.semanticText).toBe(
      'resource_type: EVENT\nevent_type: SYSTEM_UPGRADE\ntitle: PostgreSQL 16 Engine Upgrade\nsubject_ref: entity-postgresql\nparticipants: actor-alice, actor-bob\noccurred_at: 2026-08-18T10:00:00Z',
    );
    expect(rep.semanticTextDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('builds byte-stable deterministic representation for Decision', () => {
    const input: SemanticDecisionInput = {
      resourceType: 'DECISION',
      resourceId: 'decision-601',
      decisionType: 'ARCHITECTURE_DECISION',
      decision: 'Adopt hybrid semantic retrieval as a rebuildable derived projection.',
      actorRef: 'actor-lead-architect',
    };

    const rep = semanticRepresentationBuilder.build(input);
    expect(rep.resourceType).toBe('DECISION');
    expect(rep.resourceId).toBe('decision-601');
    expect(rep.semanticText).toBe(
      'resource_type: DECISION\ndecision_type: ARCHITECTURE_DECISION\ndecision: Adopt hybrid semantic retrieval as a rebuildable derived projection.\nactor_ref: actor-lead-architect',
    );
    expect(rep.semanticTextDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('preserves typed resource distinction across identical payload text', () => {
    const claimRep = semanticRepresentationBuilder.buildClaim({
      resourceType: 'CLAIM',
      resourceId: 'res-1',
      statement: 'Same text',
    });

    const decisionRep = semanticRepresentationBuilder.buildDecision({
      resourceType: 'DECISION',
      resourceId: 'res-1',
      decisionType: 'NOTE',
      decision: 'Same text',
    });

    expect(claimRep.semanticText).not.toBe(decisionRep.semanticText);
    expect(claimRep.semanticTextDigest).not.toBe(decisionRep.semanticTextDigest);
    expect(claimRep.resourceType).toBe('CLAIM');
    expect(decisionRep.resourceType).toBe('DECISION');
  });

  it('does not include secrets, credentials or wall-clock timestamps in semantic text', () => {
    const input: SemanticClaimInput = {
      resourceType: 'CLAIM',
      resourceId: 'claim-secret-test',
      statement: 'Public knowledge claim',
    };

    const rep = semanticRepresentationBuilder.build(input);
    expect(rep.semanticText).not.toContain('secret');
    expect(rep.semanticText).not.toContain('key');
    expect(rep.semanticText).not.toContain('token');
    expect(rep.semanticText).not.toContain(new Date().toISOString().slice(0, 10)); // No injected dynamic date
  });
});
