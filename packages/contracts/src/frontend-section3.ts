import {
  FrontendContractError,
  type AcceptedPolicyContext,
  type CorrelationContext,
  type FrontendCommandRequest,
  type FrontendCommandOutcomeView,
  type FrontendPolicyBinding,
  type ProductSessionView,
  type TypedPrecondition,
  deterministicCanonicalizePayload,
  decodeFrontendCommandOutcomeView,
  validateJSONValue,
  validateTypedPreconditions,
} from './frontend-foundation.js';

export type FrontendProjectContextInputV2 =
  | {
      readonly scope: 'PRINCIPAL';
      readonly activeProjectId?: never;
      readonly targetProjectId?: never;
      readonly resourceProjectId?: never;
      readonly observedProjectAccessRevision?: string;
    }
  | {
      readonly scope: 'PROJECT';
      readonly activeProjectId: string;
      readonly targetProjectId: string;
      readonly resourceProjectId?: never;
      readonly observedProjectAccessRevision?: string;
    }
  | {
      readonly scope: 'RESOURCE';
      readonly activeProjectId: string;
      readonly targetProjectId: string;
      readonly resourceProjectId: string;
      readonly observedProjectAccessRevision?: string;
    };

export type FrontendCommandRequestV2<TPayload = unknown> = {
  readonly envelopeVersion: '2.0.0';
  readonly commandType: string;
  readonly commandSchemaVersion: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectContext: FrontendProjectContextInputV2;
  readonly policyBinding: FrontendPolicyBinding;
  readonly preconditions: readonly TypedPrecondition[];
  readonly correlationContext?: CorrelationContext;
  readonly clientIssuedAt: string;
  readonly payload: TPayload;
};

export type AnyFrontendCommandRequest<TPayload = unknown> =
  FrontendCommandRequest<TPayload> | FrontendCommandRequestV2<TPayload>;

export type CreateProjectCommandPayloadV2 = {
  readonly name: string;
  readonly description?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly privacyProfile?: string;
  readonly modelProfile?: string;
  readonly costProfile?: string;
};

export type AcceptedFrontendProjectContextV2 =
  | {
      readonly scope: 'PRINCIPAL';
      readonly observedProjectAccessRevision?: string;
    }
  | {
      readonly scope: 'PROJECT';
      readonly activeProjectId: string;
      readonly targetProjectId: string;
      readonly observedProjectAccessRevision?: string;
    }
  | {
      readonly scope: 'RESOURCE';
      readonly activeProjectId: string;
      readonly targetProjectId: string;
      readonly resourceProjectId: string;
      readonly observedProjectAccessRevision?: string;
    };

export type AcceptedFrontendProjectContext =
  { readonly targetProjectId: string } | AcceptedFrontendProjectContextV2;

export type FrontendCommandOutcomeViewV2 = Omit<
  FrontendCommandOutcomeView,
  'acceptedProjectContext'
> & {
  readonly acceptedProjectContext: AcceptedFrontendProjectContextV2;
};

export type AnyFrontendCommandOutcomeView =
  FrontendCommandOutcomeView | FrontendCommandOutcomeViewV2;

export const decodeFrontendCommandOutcomeViewV2 = (
  input: unknown,
): FrontendCommandOutcomeViewV2 => {
  const value = requireRecord(input, 'FrontendCommandOutcomeView');
  const acceptedProjectContext = decodeProjectContextV2(value['acceptedProjectContext']);
  const legacyCompatible = decodeFrontendCommandOutcomeView({
    ...value,
    acceptedProjectContext: {
      targetProjectId:
        acceptedProjectContext.scope === 'PRINCIPAL'
          ? 'principal-scope'
          : acceptedProjectContext.targetProjectId,
    },
  });
  return { ...legacyCompatible, acceptedProjectContext };
};

export const decodeAnyFrontendCommandOutcomeView = (
  input: unknown,
): AnyFrontendCommandOutcomeView => {
  const value = requireRecord(input, 'FrontendCommandOutcomeView');
  const context = value['acceptedProjectContext'];
  return isRecord(context) && 'scope' in context
    ? decodeFrontendCommandOutcomeViewV2(input)
    : decodeFrontendCommandOutcomeView(input);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a plain object.`);
  }
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a non-empty string.`);
  }
  return value;
};

const optionalString = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  return requireString(value, path);
};

const rejectUnexpectedKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} contains unsupported fields: ${unexpected.join(', ')}.`,
    );
  }
};

const decodePolicyBinding = (value: unknown): FrontendPolicyBinding => {
  const binding = requireRecord(value, 'policyBinding');
  rejectUnexpectedKeys(
    binding,
    ['mode', 'observedPolicyContextRevision', 'acceptedPolicyContextId'],
    'policyBinding',
  );
  if (binding['mode'] !== 'CURRENT' && binding['mode'] !== 'PINNED_ACCEPTED_CONTEXT') {
    throw new FrontendContractError('INVALID_REQUEST', 'policyBinding.mode is unsupported.');
  }
  const observedPolicyContextRevision = optionalString(
    binding['observedPolicyContextRevision'],
    'policyBinding.observedPolicyContextRevision',
  );
  const acceptedPolicyContextId = optionalString(
    binding['acceptedPolicyContextId'],
    'policyBinding.acceptedPolicyContextId',
  );
  if (binding['mode'] === 'CURRENT' && acceptedPolicyContextId !== undefined) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'CURRENT policy binding cannot include acceptedPolicyContextId.',
    );
  }
  if (binding['mode'] === 'PINNED_ACCEPTED_CONTEXT' && acceptedPolicyContextId === undefined) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'PINNED_ACCEPTED_CONTEXT requires acceptedPolicyContextId.',
    );
  }
  return {
    mode: binding['mode'],
    ...(observedPolicyContextRevision === undefined ? {} : { observedPolicyContextRevision }),
    ...(acceptedPolicyContextId === undefined ? {} : { acceptedPolicyContextId }),
  };
};

const decodeCorrelationContext = (value: unknown): CorrelationContext | undefined => {
  if (value === undefined) return undefined;
  const context = requireRecord(value, 'correlationContext');
  rejectUnexpectedKeys(context, ['correlationId', 'causationRef'], 'correlationContext');
  const correlationId = optionalString(
    context['correlationId'],
    'correlationContext.correlationId',
  );
  if (context['causationRef'] === undefined) {
    return correlationId === undefined ? {} : { correlationId };
  }
  const causationRef = requireRecord(context['causationRef'], 'correlationContext.causationRef');
  rejectUnexpectedKeys(causationRef, ['kind', 'id', 'revision'], 'correlationContext.causationRef');
  if (!['COMMAND', 'RESOURCE', 'EVENT'].includes(String(causationRef['kind']))) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'correlationContext.causationRef.kind is unsupported.',
    );
  }
  const revision = optionalString(
    causationRef['revision'],
    'correlationContext.causationRef.revision',
  );
  return {
    ...(correlationId === undefined ? {} : { correlationId }),
    causationRef: {
      kind: causationRef['kind'] as 'COMMAND' | 'RESOURCE' | 'EVENT',
      id: requireString(causationRef['id'], 'correlationContext.causationRef.id'),
      ...(revision === undefined ? {} : { revision }),
    },
  };
};

const decodeProjectContextV2 = (value: unknown): FrontendProjectContextInputV2 => {
  const context = requireRecord(value, 'projectContext');
  rejectUnexpectedKeys(
    context,
    [
      'scope',
      'activeProjectId',
      'targetProjectId',
      'resourceProjectId',
      'observedProjectAccessRevision',
    ],
    'projectContext',
  );
  const observedProjectAccessRevision = optionalString(
    context['observedProjectAccessRevision'],
    'projectContext.observedProjectAccessRevision',
  );
  if (context['scope'] === 'PRINCIPAL') {
    if (
      context['activeProjectId'] !== undefined ||
      context['targetProjectId'] !== undefined ||
      context['resourceProjectId'] !== undefined
    ) {
      throw new FrontendContractError(
        'RESOURCE_PROJECT_MISMATCH',
        'PRINCIPAL scope cannot contain Project authority.',
      );
    }
    return {
      scope: 'PRINCIPAL',
      ...(observedProjectAccessRevision === undefined ? {} : { observedProjectAccessRevision }),
    };
  }
  const activeProjectId = requireString(
    context['activeProjectId'],
    'projectContext.activeProjectId',
  );
  const targetProjectId = requireString(
    context['targetProjectId'],
    'projectContext.targetProjectId',
  );
  if (context['scope'] === 'PROJECT') {
    if (context['resourceProjectId'] !== undefined) {
      throw new FrontendContractError(
        'RESOURCE_PROJECT_MISMATCH',
        'PROJECT scope cannot contain resourceProjectId.',
      );
    }
    return {
      scope: 'PROJECT',
      activeProjectId,
      targetProjectId,
      ...(observedProjectAccessRevision === undefined ? {} : { observedProjectAccessRevision }),
    };
  }
  if (context['scope'] === 'RESOURCE') {
    const resourceProjectId = requireString(
      context['resourceProjectId'],
      'projectContext.resourceProjectId',
    );
    if (resourceProjectId !== targetProjectId) {
      throw new FrontendContractError(
        'RESOURCE_PROJECT_MISMATCH',
        'RESOURCE scope must target the Resource Project.',
      );
    }
    return {
      scope: 'RESOURCE',
      activeProjectId,
      targetProjectId,
      resourceProjectId,
      ...(observedProjectAccessRevision === undefined ? {} : { observedProjectAccessRevision }),
    };
  }
  throw new FrontendContractError('INVALID_REQUEST', 'projectContext.scope is unsupported.');
};

export const validateFrontendCommandRequestV2 = (input: unknown): FrontendCommandRequestV2 => {
  const request = requireRecord(input, 'FrontendCommandRequest');
  rejectUnexpectedKeys(
    request,
    [
      'envelopeVersion',
      'commandType',
      'commandSchemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'projectContext',
      'policyBinding',
      'preconditions',
      'correlationContext',
      'clientIssuedAt',
      'payload',
    ],
    'FrontendCommandRequest',
  );
  const injectedAuthorityFields = [
    'commandId',
    'principal',
    'actor',
    'security',
    'securityContext',
    'capabilities',
    'traceId',
    'internalTraceId',
    'acceptedPrincipalContext',
    'acceptedProjectContext',
    'acceptedPolicyContext',
    'commandSemanticDigest',
  ].filter((field) => field in request);
  if (injectedAuthorityFields.length > 0) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Client cannot inject server authority: ${injectedAuthorityFields.join(', ')}.`,
    );
  }
  if (request['envelopeVersion'] !== '2.0.0') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported command envelope version.');
  }
  const commandType = requireString(request['commandType'], 'commandType');
  const commandSchemaVersion = requireString(
    request['commandSchemaVersion'],
    'commandSchemaVersion',
  );
  const clientRequestId = requireString(request['clientRequestId'], 'clientRequestId');
  const idempotencyKey = requireString(request['idempotencyKey'], 'idempotencyKey');
  const projectContext = decodeProjectContextV2(request['projectContext']);
  const policyBinding = decodePolicyBinding(request['policyBinding']);
  if (!Array.isArray(request['preconditions'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'preconditions must be an array.');
  }
  const preconditions = request['preconditions'] as readonly TypedPrecondition[];
  const validation = validateTypedPreconditions(preconditions);
  if (!validation.isValid) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Precondition validation failed: ${validation.errors.join('; ')}.`,
    );
  }
  const clientIssuedAt = requireString(request['clientIssuedAt'], 'clientIssuedAt');
  if (Number.isNaN(Date.parse(clientIssuedAt))) {
    throw new FrontendContractError('INVALID_REQUEST', 'clientIssuedAt must be ISO 8601.');
  }
  validateJSONValue(request['payload'], 'payload');
  const correlationContext = decodeCorrelationContext(request['correlationContext']);
  return {
    envelopeVersion: '2.0.0',
    commandType,
    commandSchemaVersion,
    clientRequestId,
    idempotencyKey,
    projectContext,
    policyBinding,
    preconditions,
    ...(correlationContext === undefined ? {} : { correlationContext }),
    clientIssuedAt,
    payload: request['payload'],
  };
};

export const validatePrincipalProjectCreateRequest = (
  input: unknown,
): FrontendCommandRequestV2<CreateProjectCommandPayloadV2> => {
  const request = validateFrontendCommandRequestV2(input);
  if (
    request.commandType !== 'project.create.v1' ||
    request.commandSchemaVersion !== '1.0.0' ||
    request.projectContext.scope !== 'PRINCIPAL'
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Zero-project creation requires PRINCIPAL project.create.v1.',
    );
  }
  if (request.projectContext.observedProjectAccessRevision !== '0') {
    throw new FrontendContractError(
      'PROJECT_ACCESS_REVISION_CONFLICT',
      'Zero-project creation requires observedProjectAccessRevision 0.',
    );
  }
  const payload = requireRecord(request.payload, 'payload');
  rejectUnexpectedKeys(
    payload,
    ['name', 'description', 'locale', 'timezone', 'privacyProfile', 'modelProfile', 'costProfile'],
    'payload',
  );
  const name = requireString(payload['name'], 'payload.name');
  const description = optionalString(payload['description'], 'payload.description');
  const locale = optionalString(payload['locale'], 'payload.locale');
  const timezone = optionalString(payload['timezone'], 'payload.timezone');
  const privacyProfile = optionalString(payload['privacyProfile'], 'payload.privacyProfile');
  const modelProfile = optionalString(payload['modelProfile'], 'payload.modelProfile');
  const costProfile = optionalString(payload['costProfile'], 'payload.costProfile');
  return {
    ...request,
    payload: {
      name,
      ...(description === undefined ? {} : { description }),
      ...(locale === undefined ? {} : { locale }),
      ...(timezone === undefined ? {} : { timezone }),
      ...(privacyProfile === undefined ? {} : { privacyProfile }),
      ...(modelProfile === undefined ? {} : { modelProfile }),
      ...(costProfile === undefined ? {} : { costProfile }),
    },
  };
};

export const frontendCommandScopeBindingKey = (request: AnyFrontendCommandRequest): string =>
  request.envelopeVersion === '1.0.0'
    ? deterministicCanonicalizePayload({
        envelopeVersion: '1.0.0',
        scope: 'PROJECT',
        targetProjectId: request.projectContext.targetProjectId,
      })
    : deterministicCanonicalizePayload({
        envelopeVersion: '2.0.0',
        ...request.projectContext,
      });

export const buildFrontendCommandV2SemanticDigestInput = (
  request: FrontendCommandRequestV2,
  principalId: string,
  acceptedPolicyContext: AcceptedPolicyContext,
): string =>
  deterministicCanonicalizePayload({
    envelopeVersion: request.envelopeVersion,
    principalId,
    projectContext: request.projectContext,
    commandType: request.commandType,
    commandSchemaVersion: request.commandSchemaVersion,
    payload: request.payload,
    preconditions: [...request.preconditions]
      .sort((left, right) =>
        `${left.purpose}:${left.subject.resourceKind}:${left.subject.resourceId}`.localeCompare(
          `${right.purpose}:${right.subject.resourceKind}:${right.subject.resourceId}`,
        ),
      )
      .map((precondition) => ({
        purpose: precondition.purpose,
        subject: precondition.subject,
        expectedRevision: precondition.expectedRevision ?? null,
        expectedDigest: precondition.expectedDigest ?? null,
        digestKind: precondition.digestKind ?? null,
      })),
    acceptedPolicyContext,
  });

export type ProductSessionViewV2 = {
  readonly apiVersion: '2.0.0';
  readonly principal: ProductSessionView['principal'];
  readonly activeProject: ProductSessionView['activeProject'] | null;
  readonly accessibleProjects: ProductSessionView['accessibleProjects'];
  readonly session: ProductSessionView['session'];
  readonly sessionReady: true;
  readonly projectReady: boolean;
  readonly projectAccessRevision: string;
};

export type AnyProductSessionView = ProductSessionView | ProductSessionViewV2;

const decodePrincipal = (value: unknown): ProductSessionView['principal'] => {
  const principal = requireRecord(value, 'principal');
  const actor = requireRecord(principal['actor'], 'principal.actor');
  const type = actor['type'];
  if (type !== 'user' && type !== 'service') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'principal.actor.type is unsupported.');
  }
  const authenticationMethod = principal['authenticationMethod'];
  if (authenticationMethod !== 'session' && authenticationMethod !== 'development') {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'principal.authenticationMethod is unsupported.',
    );
  }
  return {
    id: requireString(principal['id'], 'principal.id'),
    actor: { type, id: requireString(actor['id'], 'principal.actor.id') },
    authenticationMethod,
  };
};

const decodeProjects = (value: unknown): ProductSessionView['accessibleProjects'] => {
  if (!Array.isArray(value) || value.length > 50) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'accessibleProjects must be a bounded array.',
    );
  }
  return value.map((entry, index) => {
    const project = requireRecord(entry, `accessibleProjects[${index}]`);
    if (typeof project['isOwner'] !== 'boolean') {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        `accessibleProjects[${index}].isOwner is invalid.`,
      );
    }
    return {
      id: requireString(project['id'], `accessibleProjects[${index}].id`),
      isOwner: project['isOwner'],
    };
  });
};

export const decodeProductSessionViewV2 = (input: unknown): ProductSessionViewV2 => {
  const value = requireRecord(input, 'ProductSessionView');
  if (value['apiVersion'] !== '2.0.0') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported Product Session version.');
  }
  if (value['sessionReady'] !== true || typeof value['projectReady'] !== 'boolean') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Session readiness is invalid.');
  }
  const principal = decodePrincipal(value['principal']);
  const accessibleProjects = decodeProjects(value['accessibleProjects']);
  const session = requireRecord(value['session'], 'session');
  const expiresAt =
    session['expiresAt'] === null ? null : requireString(session['expiresAt'], 'session.expiresAt');
  const activeProjectValue = value['activeProject'];
  const activeProject =
    activeProjectValue === null
      ? null
      : {
          id: requireString(
            requireRecord(activeProjectValue, 'activeProject')['id'],
            'activeProject.id',
          ),
        };
  if (activeProject === null) {
    if (accessibleProjects.length !== 0 || value['projectReady'] !== false) {
      throw new FrontendContractError(
        'LOCAL_PROJECT_SELECTION_REQUIRED',
        'A null active Project is valid only for an empty accessible Project set.',
      );
    }
  } else if (
    value['projectReady'] !== true ||
    !accessibleProjects.some((project) => project.id === activeProject.id)
  ) {
    throw new FrontendContractError(
      'LOCAL_PROJECT_SELECTION_REQUIRED',
      'The active Project must be present in the accessible Project set.',
    );
  }
  return {
    apiVersion: '2.0.0',
    principal,
    activeProject,
    accessibleProjects,
    session: { expiresAt },
    sessionReady: true,
    projectReady: value['projectReady'],
    projectAccessRevision: requireString(value['projectAccessRevision'], 'projectAccessRevision'),
  };
};

export type NavigationAvailability =
  'AVAILABLE' | 'COMING_LATER' | 'TEMPORARILY_UNAVAILABLE' | 'ACCESS_RESTRICTED' | 'HIDDEN';

export type TargetRouteView = {
  readonly routeId:
    | 'home'
    | 'sources'
    | 'ask'
    | 'knowledge'
    | 'review'
    | 'external-action'
    | 'settings'
    | 'settings-projects';
  readonly href:
    | '/'
    | '/sources'
    | '/ask'
    | '/knowledge'
    | '/review'
    | '/external-action'
    | '/settings'
    | '/settings/projects';
};

const TARGET_ROUTES: Readonly<Record<TargetRouteView['routeId'], TargetRouteView['href']>> = {
  home: '/',
  sources: '/sources',
  ask: '/ask',
  knowledge: '/knowledge',
  review: '/review',
  'external-action': '/external-action',
  settings: '/settings',
  'settings-projects': '/settings/projects',
};

export const decodeTargetRouteView = (value: unknown): TargetRouteView => {
  const route = requireRecord(value, 'targetRoute');
  const routeId = route['routeId'];
  if (typeof routeId !== 'string' || !(routeId in TARGET_ROUTES)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unknown target route.');
  }
  const typedRouteId = routeId as TargetRouteView['routeId'];
  if (route['href'] !== TARGET_ROUTES[typedRouteId]) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Target route is not registered.');
  }
  return { routeId: typedRouteId, href: TARGET_ROUTES[typedRouteId] };
};

export type ReadinessStateView = {
  readonly kind:
    | 'SESSION_READY'
    | 'PROJECT_READY'
    | 'PRIVACY_READY'
    | 'MODEL_READY'
    | 'STORAGE_READY'
    | 'WORKER_READY'
    | 'OPTIONAL_CONNECTOR_READY';
  readonly ready: boolean;
  readonly required: boolean;
  readonly message?: string;
};

export type NavigationItemView = {
  readonly id: string;
  readonly label: string;
  readonly availability: NavigationAvailability;
  readonly reason?: string;
  readonly targetRoute?: TargetRouteView;
};

export type FeatureAvailabilityView = {
  readonly id: string;
  readonly label: string;
  readonly availability: NavigationAvailability;
  readonly reason?: string;
};

export type GlobalShellView = {
  readonly schemaVersion: '1.0.0';
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: {
    readonly id: string;
    readonly label: string;
    readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
  } | null;
  readonly accessibleProjects: readonly {
    readonly id: string;
    readonly label: string;
    readonly isOwner: boolean;
    readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
  }[];
  readonly navigation: readonly NavigationItemView[];
  readonly features: readonly FeatureAvailabilityView[];
  readonly readiness: readonly ReadinessStateView[];
  readonly leadingWarning?: {
    readonly code: string;
    readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
    readonly message: string;
    readonly additionalCount: number;
  };
  readonly background: { readonly activeCount: number; readonly failedCount: number };
  readonly notifications: {
    readonly unreadCount: number;
    readonly presentationRevision: string;
  };
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly projectionRevision: string;
  readonly fetchedAt: string;
};

export type PrimaryActionView = {
  readonly id:
    'add-source' | 'ask' | 'explore-knowledge' | 'review-changes' | 'govern-external-action';
  readonly label: string;
  readonly availability: NavigationAvailability;
  readonly disabledReason?: string;
  readonly targetRoute: TargetRouteView;
};

export type ActionCenterItem = {
  readonly stableId: string;
  readonly kind: string;
  readonly label: string;
  readonly priority: number;
  readonly reason: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly targetRoute: TargetRouteView;
  readonly createdAt: string;
};

export type ContinueWorkingItem = {
  readonly stableId: string;
  readonly origin: 'SERVER_RESOURCE';
  readonly kind: string;
  readonly label: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly targetRoute: TargetRouteView;
  readonly updatedAt: string;
};

export type BrowserDraftPresentationView = {
  readonly draftId: string;
  readonly origin: 'BROWSER_DRAFT';
  readonly label: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly sourceRevision: string;
  readonly expiresAt: string;
  readonly targetRoute: TargetRouteView;
};

export type ResourcePresentationView = {
  readonly stableId: string;
  readonly kind: string;
  readonly label: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly targetRoute: TargetRouteView;
  readonly updatedAt: string;
};

export type HomeActionCenterView = {
  readonly schemaVersion: '1.0.0';
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: { readonly id: string; readonly label: string };
  readonly projectState: {
    readonly lifecycle: 'ACTIVE' | 'ARCHIVED' | 'UNAVAILABLE';
    readonly message: string;
  };
  readonly primaryActions: readonly PrimaryActionView[];
  readonly attention: readonly ActionCenterItem[];
  readonly continueWorking: readonly ContinueWorkingItem[];
  readonly recent: readonly ResourcePresentationView[];
  readonly pinned: readonly ResourcePresentationView[];
  readonly operationalSummary: {
    readonly activeBackgroundCount: number;
    readonly failedBackgroundCount: number;
    readonly unreadNotificationCount: number;
  };
  readonly stale: boolean;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly projectionRevision: string;
  readonly fetchedAt: string;
};

export type GlobalSearchRequest = {
  readonly schemaVersion: '1.0.0';
  readonly query: string;
  readonly scope:
    | { readonly kind: 'ACTIVE_PROJECT' }
    | { readonly kind: 'CROSS_PROJECT'; readonly projectIds: readonly string[] };
  readonly limit: number;
};

export type GlobalSearchResultView = {
  readonly schemaVersion: '1.0.0';
  readonly scope: 'ACTIVE_PROJECT' | 'CROSS_PROJECT';
  readonly results: readonly {
    readonly stableId: string;
    readonly kind: string;
    readonly label: string;
    readonly safeHighlight?: string;
    readonly projectId: string;
    readonly projectLabel: string;
    readonly targetRoute: TargetRouteView;
  }[];
  readonly projectionRevision: string;
  readonly fetchedAt: string;
};

export type RouteGuardDecisionView = {
  readonly schemaVersion: '1.0.0';
  readonly decision:
    | 'ALLOW'
    | 'SESSION_REQUIRED'
    | 'BACKEND_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'ACCESS_DENIED'
    | 'PROJECT_UNAVAILABLE'
    | 'FEATURE_UNAVAILABLE'
    | 'RESOURCE_RETIRED';
  readonly targetRoute?: TargetRouteView;
  readonly activeProjectId?: string;
  readonly resourceProject?: { readonly id: string; readonly label: string };
  readonly masked: boolean;
  readonly message: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

const NAVIGATION_AVAILABILITY = new Set<NavigationAvailability>([
  'AVAILABLE',
  'COMING_LATER',
  'TEMPORARILY_UNAVAILABLE',
  'ACCESS_RESTRICTED',
  'HIDDEN',
]);

const SENSITIVITY_LEVELS = new Set(['public', 'internal', 'private', 'restricted'] as const);

const requireSensitivity = (
  value: unknown,
  path: string,
): 'public' | 'internal' | 'private' | 'restricted' => {
  if (!SENSITIVITY_LEVELS.has(value as 'public')) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} is unsupported.`);
  }
  return value as 'public' | 'internal' | 'private' | 'restricted';
};

const requireBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} must be boolean.`);
  }
  return value;
};

const requireNonNegativeInteger = (value: unknown, path: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      `${path} must be a non-negative integer.`,
    );
  }
  return value as number;
};

const requireTimestamp = (value: unknown, path: string): string => {
  const timestamp = requireString(value, path);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} must be ISO 8601.`);
  }
  return timestamp;
};

const decodeFeature = (value: unknown, path: string): FeatureAvailabilityView => {
  const feature = requireRecord(value, path);
  if (!NAVIGATION_AVAILABILITY.has(feature['availability'] as NavigationAvailability)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path}.availability is unsupported.`);
  }
  const reason = optionalString(feature['reason'], `${path}.reason`);
  return {
    id: requireString(feature['id'], `${path}.id`),
    label: requireString(feature['label'], `${path}.label`),
    availability: feature['availability'] as NavigationAvailability,
    ...(reason === undefined ? {} : { reason }),
  };
};

const decodeNavigationItem = (value: unknown, path: string): NavigationItemView => {
  const item = requireRecord(value, path);
  if (!NAVIGATION_AVAILABILITY.has(item['availability'] as NavigationAvailability)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path}.availability is unsupported.`);
  }
  const availability = item['availability'] as NavigationAvailability;
  const targetRoute =
    item['targetRoute'] === undefined ? undefined : decodeTargetRouteView(item['targetRoute']);
  if (availability === 'AVAILABLE' && targetRoute === undefined) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      `${path} requires a registered route when available.`,
    );
  }
  if (availability !== 'AVAILABLE' && targetRoute !== undefined) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      `${path} cannot expose a route when unavailable.`,
    );
  }
  const reason = optionalString(item['reason'], `${path}.reason`);
  return {
    id: requireString(item['id'], `${path}.id`),
    label: requireString(item['label'], `${path}.label`),
    availability,
    ...(reason === undefined ? {} : { reason }),
    ...(targetRoute === undefined ? {} : { targetRoute }),
  };
};

export const decodeGlobalShellView = (input: unknown): GlobalShellView => {
  const value = requireRecord(input, 'GlobalShellView');
  if (value['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported Global Shell version.');
  }
  if (!Array.isArray(value['accessibleProjects']) || value['accessibleProjects'].length > 50) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Global Shell Project list must be bounded.',
    );
  }
  if (!Array.isArray(value['navigation']) || value['navigation'].length > 8) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Navigation must be bounded.');
  }
  if (!Array.isArray(value['features']) || value['features'].length > 20) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Features must be bounded.');
  }
  if (!Array.isArray(value['readiness']) || value['readiness'].length > 7) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Readiness must be bounded.');
  }
  const accessibleProjects = value['accessibleProjects'].map((entry, index) => {
    const project = requireRecord(entry, `accessibleProjects[${index}]`);
    return {
      id: requireString(project['id'], `accessibleProjects[${index}].id`),
      label: requireString(project['label'], `accessibleProjects[${index}].label`),
      isOwner: requireBoolean(project['isOwner'], `accessibleProjects[${index}].isOwner`),
      sensitivityClearance: requireSensitivity(
        project['sensitivityClearance'],
        `accessibleProjects[${index}].sensitivityClearance`,
      ),
    };
  });
  const activeValue = value['activeProject'];
  const activeProject =
    activeValue === null
      ? null
      : {
          id: requireString(requireRecord(activeValue, 'activeProject')['id'], 'activeProject.id'),
          label: requireString(
            requireRecord(activeValue, 'activeProject')['label'],
            'activeProject.label',
          ),
          sensitivityClearance: requireSensitivity(
            requireRecord(activeValue, 'activeProject')['sensitivityClearance'],
            'activeProject.sensitivityClearance',
          ),
        };
  if (
    (activeProject === null && accessibleProjects.length !== 0) ||
    (activeProject !== null &&
      !accessibleProjects.some((project) => project.id === activeProject.id))
  ) {
    throw new FrontendContractError(
      'LOCAL_PROJECT_SELECTION_REQUIRED',
      'Global Shell active Project binding is inconsistent.',
    );
  }
  const readinessKinds = new Set<ReadinessStateView['kind']>([
    'SESSION_READY',
    'PROJECT_READY',
    'PRIVACY_READY',
    'MODEL_READY',
    'STORAGE_READY',
    'WORKER_READY',
    'OPTIONAL_CONNECTOR_READY',
  ]);
  const readiness = value['readiness'].map((entry, index) => {
    const state = requireRecord(entry, `readiness[${index}]`);
    if (!readinessKinds.has(state['kind'] as ReadinessStateView['kind'])) {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        `readiness[${index}].kind is unsupported.`,
      );
    }
    const message = optionalString(state['message'], `readiness[${index}].message`);
    return {
      kind: state['kind'] as ReadinessStateView['kind'],
      ready: requireBoolean(state['ready'], `readiness[${index}].ready`),
      required: requireBoolean(state['required'], `readiness[${index}].required`),
      ...(message === undefined ? {} : { message }),
    };
  });
  const background = requireRecord(value['background'], 'background');
  const notifications = requireRecord(value['notifications'], 'notifications');
  const warningValue = value['leadingWarning'];
  let leadingWarning: GlobalShellView['leadingWarning'];
  if (warningValue !== undefined) {
    const warning = requireRecord(warningValue, 'leadingWarning');
    if (!['INFO', 'WARNING', 'CRITICAL'].includes(String(warning['severity']))) {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        'leadingWarning.severity is unsupported.',
      );
    }
    leadingWarning = {
      code: requireString(warning['code'], 'leadingWarning.code'),
      severity: warning['severity'] as 'INFO' | 'WARNING' | 'CRITICAL',
      message: requireString(warning['message'], 'leadingWarning.message'),
      additionalCount: requireNonNegativeInteger(
        warning['additionalCount'],
        'leadingWarning.additionalCount',
      ),
    };
  }
  return {
    schemaVersion: '1.0.0',
    principalId: requireString(value['principalId'], 'principalId'),
    sessionId: requireString(value['sessionId'], 'sessionId'),
    activeProject,
    accessibleProjects,
    navigation: value['navigation'].map((entry, index) =>
      decodeNavigationItem(entry, `navigation[${index}]`),
    ),
    features: value['features'].map((entry, index) => decodeFeature(entry, `features[${index}]`)),
    readiness,
    ...(leadingWarning === undefined ? {} : { leadingWarning }),
    background: {
      activeCount: requireNonNegativeInteger(background['activeCount'], 'background.activeCount'),
      failedCount: requireNonNegativeInteger(background['failedCount'], 'background.failedCount'),
    },
    notifications: {
      unreadCount: requireNonNegativeInteger(
        notifications['unreadCount'],
        'notifications.unreadCount',
      ),
      presentationRevision: requireString(
        notifications['presentationRevision'],
        'notifications.presentationRevision',
      ),
    },
    accessRevision: requireString(value['accessRevision'], 'accessRevision'),
    policyContextRevision: requireString(value['policyContextRevision'], 'policyContextRevision'),
    projectionRevision: requireString(value['projectionRevision'], 'projectionRevision'),
    fetchedAt: requireTimestamp(value['fetchedAt'], 'fetchedAt'),
  };
};

export const decodeHomeActionCenterView = (input: unknown): HomeActionCenterView => {
  const value = requireRecord(input, 'HomeActionCenterView');
  if (value['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported Home version.');
  }
  for (const [key, cap] of [
    // FE-P4-S2 WP5: the External Action governance workspace primary action
    // was added (AC-18), so the bounded primary-action cap is 5.
    ['primaryActions', 5],
    ['attention', 50],
    ['continueWorking', 50],
    ['recent', 50],
    ['pinned', 50],
  ] as const) {
    if (!Array.isArray(value[key]) || value[key].length > cap) {
      throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${key} exceeds its safety cap.`);
    }
  }
  const activeProjectValue = requireRecord(value['activeProject'], 'activeProject');
  const activeProject = {
    id: requireString(activeProjectValue['id'], 'activeProject.id'),
    label: requireString(activeProjectValue['label'], 'activeProject.label'),
  };
  const projectStateValue = requireRecord(value['projectState'], 'projectState');
  if (!['ACTIVE', 'ARCHIVED', 'UNAVAILABLE'].includes(String(projectStateValue['lifecycle']))) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'projectState.lifecycle is unsupported.');
  }
  const primaryIds = new Set<PrimaryActionView['id']>([
    'add-source',
    'ask',
    'explore-knowledge',
    'review-changes',
    'govern-external-action',
  ]);
  const primaryActions = (value['primaryActions'] as unknown[]).map((entry, index) => {
    const action = requireRecord(entry, `primaryActions[${index}]`);
    if (
      !primaryIds.has(action['id'] as PrimaryActionView['id']) ||
      !NAVIGATION_AVAILABILITY.has(action['availability'] as NavigationAvailability)
    ) {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        `primaryActions[${index}] is unsupported.`,
      );
    }
    const disabledReason = optionalString(
      action['disabledReason'],
      `primaryActions[${index}].disabledReason`,
    );
    return {
      id: action['id'] as PrimaryActionView['id'],
      label: requireString(action['label'], `primaryActions[${index}].label`),
      availability: action['availability'] as NavigationAvailability,
      ...(disabledReason === undefined ? {} : { disabledReason }),
      targetRoute: decodeTargetRouteView(action['targetRoute']),
    };
  });
  const decodeResource = (entry: unknown, path: string): ResourcePresentationView => {
    const item = requireRecord(entry, path);
    const projectId = requireString(item['projectId'], `${path}.projectId`);
    if (projectId !== activeProject.id) {
      throw new FrontendContractError(
        'RESOURCE_PROJECT_MISMATCH',
        `${path} is not bound to the active Project.`,
      );
    }
    return {
      stableId: requireString(item['stableId'], `${path}.stableId`),
      kind: requireString(item['kind'], `${path}.kind`),
      label: requireString(item['label'], `${path}.label`),
      projectId,
      resourceId: requireString(item['resourceId'], `${path}.resourceId`),
      targetRoute: decodeTargetRouteView(item['targetRoute']),
      updatedAt: requireTimestamp(item['updatedAt'], `${path}.updatedAt`),
    };
  };
  const attention = (value['attention'] as unknown[]).map((entry, index) => {
    const path = `attention[${index}]`;
    const item = requireRecord(entry, path);
    const resource = decodeResource({ ...item, updatedAt: item['createdAt'] }, path);
    return {
      stableId: resource.stableId,
      kind: resource.kind,
      label: resource.label,
      priority: requireNonNegativeInteger(item['priority'], `${path}.priority`),
      reason: requireString(item['reason'], `${path}.reason`),
      projectId: resource.projectId,
      resourceId: resource.resourceId,
      targetRoute: resource.targetRoute,
      createdAt: requireTimestamp(item['createdAt'], `${path}.createdAt`),
    };
  });
  const continueWorking = (value['continueWorking'] as unknown[]).map((entry, index) => {
    const path = `continueWorking[${index}]`;
    const item = requireRecord(entry, path);
    if (item['origin'] !== 'SERVER_RESOURCE') {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        `${path}.origin must be SERVER_RESOURCE.`,
      );
    }
    return {
      ...decodeResource(item, path),
      origin: 'SERVER_RESOURCE' as const,
    };
  });
  const operational = requireRecord(value['operationalSummary'], 'operationalSummary');
  return {
    schemaVersion: '1.0.0',
    principalId: requireString(value['principalId'], 'principalId'),
    sessionId: requireString(value['sessionId'], 'sessionId'),
    activeProject,
    projectState: {
      lifecycle: projectStateValue[
        'lifecycle'
      ] as HomeActionCenterView['projectState']['lifecycle'],
      message: requireString(projectStateValue['message'], 'projectState.message'),
    },
    primaryActions,
    attention,
    continueWorking,
    recent: (value['recent'] as unknown[]).map((entry, index) =>
      decodeResource(entry, `recent[${index}]`),
    ),
    pinned: (value['pinned'] as unknown[]).map((entry, index) =>
      decodeResource(entry, `pinned[${index}]`),
    ),
    operationalSummary: {
      activeBackgroundCount: requireNonNegativeInteger(
        operational['activeBackgroundCount'],
        'operationalSummary.activeBackgroundCount',
      ),
      failedBackgroundCount: requireNonNegativeInteger(
        operational['failedBackgroundCount'],
        'operationalSummary.failedBackgroundCount',
      ),
      unreadNotificationCount: requireNonNegativeInteger(
        operational['unreadNotificationCount'],
        'operationalSummary.unreadNotificationCount',
      ),
    },
    stale: requireBoolean(value['stale'], 'stale'),
    accessRevision: requireString(value['accessRevision'], 'accessRevision'),
    policyContextRevision: requireString(value['policyContextRevision'], 'policyContextRevision'),
    projectionRevision: requireString(value['projectionRevision'], 'projectionRevision'),
    fetchedAt: requireTimestamp(value['fetchedAt'], 'fetchedAt'),
  };
};

export const decodeGlobalSearchRequest = (input: unknown): GlobalSearchRequest => {
  const value = requireRecord(input, 'GlobalSearchRequest');
  rejectUnexpectedKeys(value, ['schemaVersion', 'query', 'scope', 'limit'], 'GlobalSearchRequest');
  if (value['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported Global Search version.');
  }
  const query = requireString(value['query'], 'query');
  if (query.length > 500) {
    throw new FrontendContractError('INVALID_REQUEST', 'Search query exceeds the input cap.');
  }
  const limit = value['limit'];
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 20) {
    throw new FrontendContractError('INVALID_REQUEST', 'Search limit must be between 1 and 20.');
  }
  const scope = requireRecord(value['scope'], 'scope');
  if (scope['kind'] === 'ACTIVE_PROJECT') {
    rejectUnexpectedKeys(scope, ['kind'], 'scope');
    return {
      schemaVersion: '1.0.0',
      query,
      scope: { kind: 'ACTIVE_PROJECT' },
      limit: limit as number,
    };
  }
  rejectUnexpectedKeys(scope, ['kind', 'projectIds'], 'scope');
  if (
    scope['kind'] !== 'CROSS_PROJECT' ||
    !Array.isArray(scope['projectIds']) ||
    scope['projectIds'].length === 0 ||
    scope['projectIds'].length > 50
  ) {
    throw new FrontendContractError('INVALID_REQUEST', 'Cross-project Search scope is invalid.');
  }
  const projectIds = scope['projectIds'].map((id, index) =>
    requireString(id, `scope.projectIds[${index}]`),
  );
  if (new Set(projectIds).size !== projectIds.length) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Cross-project Search scope contains duplicate Project IDs.',
    );
  }
  return {
    schemaVersion: '1.0.0',
    query,
    scope: {
      kind: 'CROSS_PROJECT',
      projectIds,
    },
    limit: limit as number,
  };
};

export const decodeGlobalSearchResultView = (input: unknown): GlobalSearchResultView => {
  const value = requireRecord(input, 'GlobalSearchResultView');
  if (
    value['schemaVersion'] !== '1.0.0' ||
    (value['scope'] !== 'ACTIVE_PROJECT' && value['scope'] !== 'CROSS_PROJECT') ||
    !Array.isArray(value['results']) ||
    value['results'].length > 20
  ) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Global Search response is invalid.');
  }
  const results = value['results'].map((entry, index) => {
    const path = `results[${index}]`;
    const result = requireRecord(entry, path);
    const safeHighlight = optionalString(result['safeHighlight'], `${path}.safeHighlight`);
    return {
      stableId: requireString(result['stableId'], `${path}.stableId`),
      kind: requireString(result['kind'], `${path}.kind`),
      label: requireString(result['label'], `${path}.label`),
      ...(safeHighlight === undefined ? {} : { safeHighlight }),
      projectId: requireString(result['projectId'], `${path}.projectId`),
      projectLabel: requireString(result['projectLabel'], `${path}.projectLabel`),
      targetRoute: decodeTargetRouteView(result['targetRoute']),
    };
  });
  return {
    schemaVersion: '1.0.0',
    scope: value['scope'] as GlobalSearchResultView['scope'],
    results,
    projectionRevision: requireString(value['projectionRevision'], 'projectionRevision'),
    fetchedAt: requireTimestamp(value['fetchedAt'], 'fetchedAt'),
  };
};

const ROUTE_GUARD_DECISIONS = new Set<RouteGuardDecisionView['decision']>([
  'ALLOW',
  'SESSION_REQUIRED',
  'BACKEND_UNAVAILABLE',
  'NOT_FOUND',
  'ACCESS_DENIED',
  'PROJECT_UNAVAILABLE',
  'FEATURE_UNAVAILABLE',
  'RESOURCE_RETIRED',
]);

export const decodeRouteGuardDecisionView = (input: unknown): RouteGuardDecisionView => {
  const value = requireRecord(input, 'RouteGuardDecisionView');
  if (
    value['schemaVersion'] !== '1.0.0' ||
    !ROUTE_GUARD_DECISIONS.has(value['decision'] as RouteGuardDecisionView['decision']) ||
    typeof value['masked'] !== 'boolean'
  ) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Route Guard response is invalid.');
  }
  if (value['decision'] === 'ALLOW' && value['targetRoute'] === undefined) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Allowed route decision needs a route.');
  }
  if (value['decision'] !== 'ALLOW' && value['targetRoute'] !== undefined) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Denied route decision cannot expose a target route.',
    );
  }
  const targetRoute =
    value['targetRoute'] === undefined ? undefined : decodeTargetRouteView(value['targetRoute']);
  const activeProjectId = optionalString(value['activeProjectId'], 'activeProjectId');
  const resourceValue = value['resourceProject'];
  const resourceProject =
    resourceValue === undefined
      ? undefined
      : {
          id: requireString(
            requireRecord(resourceValue, 'resourceProject')['id'],
            'resourceProject.id',
          ),
          label: requireString(
            requireRecord(resourceValue, 'resourceProject')['label'],
            'resourceProject.label',
          ),
        };
  return {
    schemaVersion: '1.0.0',
    decision: value['decision'] as RouteGuardDecisionView['decision'],
    ...(targetRoute === undefined ? {} : { targetRoute }),
    ...(activeProjectId === undefined ? {} : { activeProjectId }),
    ...(resourceProject === undefined ? {} : { resourceProject }),
    masked: value['masked'],
    message: requireString(value['message'], 'message'),
    accessRevision: requireString(value['accessRevision'], 'accessRevision'),
    policyContextRevision: requireString(value['policyContextRevision'], 'policyContextRevision'),
  };
};
