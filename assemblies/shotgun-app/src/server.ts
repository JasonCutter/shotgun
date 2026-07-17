import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import Fastify from 'fastify';

import {
  InMemoryAuthRepository,
  authorize,
  hashPassword,
  hashSecuritySecret,
  type AuthRepositoryPort,
  type TrustedSecurityContext,
} from '../../../packages/authentication/src/index.js';

import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../../adapters/stage3-in-memory/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../../adapters/stage4-in-memory/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import { PythonDocumentFormatAdapter } from '../../../adapters/document-format-python/src/index.js';
import {
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../../adapters/stage5-in-memory/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../../adapters/stage6-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../../adapters/stage7-in-memory/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../../adapters/stage9-in-memory/src/index.js';
import { InMemoryCompiledTruthRepository } from '../../../adapters/stage10-in-memory/src/index.js';
import {
  InMemoryActionCandidateRepository,
  InMemoryActionExecutionRepository,
} from '../../../adapters/stage11-in-memory/src/index.js';
import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import { InProcessTransport } from '../../../adapters/transport-in-process/src/index.js';
import {
  createChildQuery,
  createCommand,
  createQuery,
  actionEvidenceSetDigest,
  ShotgunError,
  ShotgunKernel,
  type AssetReference,
  type MessageTransport,
  type SecurityContext,
  type ApprovedChangeSetManifest,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalSnapshot,
  type CanonicalSearchResponse,
  type CitedAnswer,
  type ClaimCandidate,
  type ComparisonResult,
  type DraftChangeSet,
  type EvidenceSpan,
  type TextDiffSegment,
  type EntityCandidate,
  type EntityVaultImport,
  type KnowledgeCandidate,
  type KnowledgeGraphView,
  type KnowledgeImpactResult,
  type KnowledgeReviewGroup,
  type CompiledTruthProjection,
  type CompiledTruthProjectionStatus,
  type DerivedInferenceCandidate,
  type DiscoveryRunResult,
  type ActionAuditEvent,
  type ActionExecutionRecord,
} from '../../../packages/kernel/src/index.js';
import {
  createIntakeModule,
  type IntakeRepositoryPort,
  type SubmitIntakePayload,
} from '../../../modules/intake/src/index.js';
import {
  type AssetStoragePort,
  createOriginalAssetModule,
  type OriginalAssetRepositoryPort,
} from '../../../modules/original-asset/src/index.js';
import {
  createEvidenceModule,
  type EvidenceLocatorPort,
  type EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
  type AIProviderCallRepositoryPort,
  type AIProviderPolicy,
} from '../../../modules/ai-provider/src/index.js';
import {
  createCandidateGenerationModule,
  type CandidateRepositoryPort,
} from '../../../modules/candidate-generation/src/index.js';
import {
  createValidationModule,
  type ValidationRepositoryPort,
} from '../../../modules/validation/src/index.js';
import {
  createComparisonModule,
  type CanonicalSnapshotPort,
  type ComparisonRepositoryPort,
  type TextDiffPort,
} from '../../../modules/comparison/src/index.js';
import {
  createChangeSetReviewModule,
  type ChangeSetReviewRepositoryPort,
} from '../../../modules/change-set-review/src/index.js';
import {
  createCanonicalKnowledgeModule,
  type CanonicalKnowledgeRepositoryPort,
} from '../../../modules/canonical-knowledge/src/index.js';
import { createCitedAnswerModule } from '../../../modules/cited-answer/src/index.js';
import {
  createProjectionSearchModule,
  type SearchProjectionRepositoryPort,
} from '../../../modules/projection-search/src/index.js';
import {
  createTransformationModule,
  type PlainTextTransformerPort,
  type TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';
import { createPingModule } from '../../../modules/ping/src/index.js';
import { createPongModule } from '../../../modules/pong/src/index.js';
import {
  createKnowledgeModelModule,
  type KnowledgeModelRepositoryPort,
} from '../../../modules/knowledge-model/src/index.js';
import {
  createCompiledTruthModule,
  type CompiledTruthRepositoryPort,
} from '../../../modules/compiled-truth/src/index.js';
import {
  type ActionConnectorPort,
  type ActionCandidateRepositoryPort,
  type ActionExecutionRepositoryPort,
  createActionExecutionModule,
} from '../../../modules/action-execution/src/index.js';

type PingRequest = {
  readonly requestId?: string;
  readonly message?: string;
};

type ResolveAssetRequest = {
  readonly assetReference: AssetReference;
};

type SourceVersionRequest = {
  readonly sourceVersionId: string;
};

type EvidenceRequest = {
  readonly evidenceId: string;
};

type CandidateRequest = {
  readonly candidateId: string;
};

type ComparisonRequest = {
  readonly comparisonId: string;
};

type ChangeSetRequest = {
  readonly changeSetId: string;
};

type CanonicalClaimRequest = {
  readonly claimId: string;
};

type CanonicalCommitRequest = {
  readonly commitId: string;
};

type SearchRequest = { readonly query: string; readonly limit?: number };
type AskRequest = { readonly question: string; readonly limit?: number };

type KnowledgeStageRequest = {
  readonly groupId: string;
  readonly sourceVersionId: string;
  readonly items: readonly KnowledgeCandidate[];
};

type KnowledgeReviewRequest = {
  readonly decisionId?: string;
  readonly groupId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT' | 'EDIT';
  readonly reason: string;
  readonly itemIds: readonly string[];
  readonly editKind?:
    'WORDING_LAYOUT' | 'FACTUAL_CORRECTION' | 'NEW_KNOWLEDGE' | 'REFERENCE_CHANGE';
};

type KnowledgeImpactRequest = {
  readonly rootCandidateId: string;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
};

type EntityVaultStageRequest = {
  readonly importId: string;
  readonly sourceVersionId: string;
  readonly entities: readonly EntityCandidate[];
};

type EntityVaultReviewRequest = {
  readonly importId: string;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'REJECT';
};

type ReviewDecisionRequest = ChangeSetRequest & {
  readonly decisionId?: string;
  readonly expectedRevisionNumber: 1;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT';
  readonly reason: string;
};

type SecurityHeaders = {
  readonly 'x-project-id'?: string;
  readonly 'x-actor-id'?: string;
  readonly 'x-access-scope'?: string;
  readonly 'x-sensitivity'?: SecurityContext['sensitivity'];
  readonly 'x-shotgun-project'?: string;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly 'x-csrf-token'?: string;
};

type ApplicationOptions = {
  readonly transport?: MessageTransport;
  readonly intakeRepository?: IntakeRepositoryPort;
  readonly originalAssetRepository?: OriginalAssetRepositoryPort;
  readonly assetStorage?: AssetStoragePort;
  readonly transformationRepository?: TransformationRepositoryPort;
  readonly evidenceRepository?: EvidenceRepositoryPort;
  readonly transformer?: PlainTextTransformerPort;
  readonly evidenceLocator?: EvidenceLocatorPort;
  readonly aiProviderRepository?: AIProviderCallRepositoryPort;
  readonly candidateRepository?: CandidateRepositoryPort;
  readonly validationRepository?: ValidationRepositoryPort;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly canonicalSnapshot?: CanonicalSnapshotPort;
  readonly textDiff?: TextDiffPort;
  readonly comparisonRepository?: ComparisonRepositoryPort;
  readonly changeSetReviewRepository?: ChangeSetReviewRepositoryPort;
  readonly canonicalKnowledgeRepository?: CanonicalKnowledgeRepositoryPort;
  readonly searchProjectionRepository?: SearchProjectionRepositoryPort;
  readonly knowledgeModelRepository?: KnowledgeModelRepositoryPort;
  readonly compiledTruthRepository?: CompiledTruthRepositoryPort;
  readonly actionCandidateRepository?: ActionCandidateRepositoryPort;
  readonly actionExecutionRepository?: ActionExecutionRepositoryPort;
  readonly actionConnector?: ActionConnectorPort;
  readonly authRepository?: AuthRepositoryPort;
  readonly production?: boolean;
  readonly closeResources?: () => Promise<void>;
};

const trustedRequestContexts = new WeakMap<object, TrustedSecurityContext>();

const askPage = (): string => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Ask</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#172033}
    form{display:flex;gap:8px} input{flex:1;padding:12px} button{padding:12px 18px}
    article{margin-top:24px;padding:16px;border:1px solid #d9e0ea;border-radius:10px}
    small{color:#526173} .error{color:#a11} ul{padding-left:22px}
  </style>
</head>
<body>
  <h1>Shotgun Ask</h1>
  <p>승인된 Canonical Claim만 검색하며, 모든 답변에 원문 근거를 표시합니다.</p>
  <form id="ask-form">
    <input id="question" required placeholder="예: Milo의 몸무게는?">
    <button>질문</button>
  </form>
  <p id="state"></p><section id="answer"></section>
  <script>
    const form=document.querySelector('#ask-form');
    const state=document.querySelector('#state');
    const answer=document.querySelector('#answer');
    form.addEventListener('submit',async(event)=>{
      event.preventDefault(); answer.replaceChildren(); state.textContent='검색 중…';
      try {
        const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
        const response=await fetch('/ask/query',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({question:document.querySelector('#question').value})});
        const body=await response.json(); if(!response.ok) throw new Error(body.message||'요청 실패');
        const result=body.answer; state.textContent='Projection: '+result.readiness.status+' / 지연: '+result.readiness.lag;
        if(result.uncertainty){const p=document.createElement('p');p.className='error';p.textContent=result.uncertainty;answer.append(p);}
        result.statements.forEach(statement=>{
          const article=document.createElement('article');const p=document.createElement('p');p.textContent=statement.text;article.append(p);
          const list=document.createElement('ul');statement.citations.forEach(citation=>{const li=document.createElement('li');const link=document.createElement('a');link.href='/evidence/'+encodeURIComponent(citation.evidenceId);link.textContent='원문: '+citation.exactQuote;li.append(link);list.append(li);});article.append(list);answer.append(article);
        });
      } catch(error) { state.textContent=''; const p=document.createElement('p');p.className='error';p.textContent=error.message;answer.append(p); }
    });
  </script>
</body>
</html>`;

const knowledgePage = (): string => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Knowledge Graph</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033}
    #graph{height:420px;border:1px solid #d9e0ea;border-radius:10px;margin:20px 0;background:#fbfcfe}
    table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #d9e0ea;padding:9px;text-align:left}
    th{background:#f3f6fa}.warning{color:#9a5b00;font-weight:700}.muted{color:#526173}
  </style>
</head>
<body>
  <h1>Compiled Truth 그래프</h1>
  <p>승인된 지식을 2D 그래프로 보고, 화면을 사용할 수 없을 때도 같은 데이터의 목록·표를 확인합니다.</p>
  <p id="state" class="muted">불러오는 중…</p>
  <div id="graph" role="img" aria-label="승인된 지식의 2D 관계 그래프"></div>
  <h2>지식 목록·표 보기</h2>
  <table aria-label="승인된 지식 항목">
    <thead><tr><th>ID</th><th>유형</th><th>내용</th><th>시간 상태</th><th>근거</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <script src="/vendor/cytoscape.min.js"></script>
  <script>
    const state=document.querySelector('#state');const rows=document.querySelector('#rows');
    (async()=>{try{
      const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
      const response=await fetch('/compiled-truth/query',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:'{}'});
      const body=await response.json();if(!response.ok)throw new Error(body.message||'요청 실패');
      const {projection,status}=body;const graph=projection.graph;state.textContent='상태 '+status.status+' / 지연 '+status.lag+' / 항목 '+projection.items.length+'개 / 관계 '+graph.edges.length+'개';projection.items.forEach(item=>{const row=document.createElement('tr');[item.id,item.type,item.label,item.state,String(item.evidenceIds.length)].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});rows.append(row);});window.cytoscape({container:document.querySelector('#graph'),elements:[...graph.nodes.map(node=>({data:{id:node.id,label:node.label,state:node.state}})),...graph.edges.map(edge=>({data:{id:edge.id,source:edge.from,target:edge.to,label:edge.relationType}}))],style:[{selector:'node',style:{label:'data(label)','background-color':'#4776e6','font-size':'11px','text-wrap':'wrap','text-max-width':'100px'}},{selector:'edge',style:{label:'data(label)','curve-style':'bezier','target-arrow-shape':'triangle','line-color':'#91a0b5','target-arrow-color':'#91a0b5','font-size':'9px'}}],layout:{name:'cose',animate:false}});
    }catch(error){state.textContent=error.message;state.className='warning';}})();
  </script>
</body>
</html>`;

const requestContext = (headers: SecurityHeaders) => {
  const context = trustedRequestContexts.get(headers as object);
  if (!context) {
    throw new ShotgunError({
      code: 'AUTHENTICATION_REQUIRED',
      safeMessage: 'Authentication is required.',
      module: 'shotgun-app',
      operation: 'trusted-request-context',
    });
  }
  return { projectId: context.projectId, actor: context.actor, security: context.security };
};

const requireActionPreviewRequest = (
  body: unknown,
): {
  readonly candidateId: string;
  readonly expectedRevision: number;
  readonly operationKey: string;
} => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 3 ||
    !Object.keys(body).every((key) =>
      ['candidateId', 'expectedRevision', 'operationKey'].includes(key),
    )
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Preview accepts only candidateId, expectedRevision, and operationKey.',
      module: 'shotgun-app',
      operation: 'validate-action-preview-request',
    });
  }
  const request = body as Record<string, unknown>;
  if (
    typeof request.candidateId !== 'string' ||
    !request.candidateId ||
    !Number.isInteger(request.expectedRevision) ||
    (request.expectedRevision as number) < 1 ||
    typeof request.operationKey !== 'string'
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Preview request values are invalid.',
      module: 'shotgun-app',
      operation: 'validate-action-preview-request',
    });
  }
  return request as {
    readonly candidateId: string;
    readonly expectedRevision: number;
    readonly operationKey: string;
  };
};

const requireActionExecuteRequest = (body: unknown): { readonly approvalId: string } => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'approvalId') ||
    typeof (body as { approvalId?: unknown }).approvalId !== 'string'
  ) {
    throw new ShotgunError({
      code: 'ACTION_SERVER_BINDING_REQUIRED',
      safeMessage: 'Execute accepts only approvalId.',
      module: 'shotgun-app',
      operation: 'validate-action-execute-request',
    });
  }
  return body as { readonly approvalId: string };
};

const parseCookie = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const isStateChanging = (method: string): boolean =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

const traceView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.traces.findByTraceId(traceId).map((record) => ({
    messageType: record.messageType,
    messageKind: record.messageKind,
    consumerModule: record.consumerModule,
    status: record.status,
    attemptNumber: record.attemptNumber,
  }));

const auditView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.audit.findByTraceId(traceId).map((record) => ({
    category: record.category,
    messageType: record.messageType,
    moduleId: record.moduleId,
    status: record.status,
  }));

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const diffHtml = (segments: readonly TextDiffSegment[]): string =>
  segments
    .map((segment) => {
      const tag = segment.type === 'insert' ? 'ins' : segment.type === 'delete' ? 'del' : 'span';
      return `<${tag}>${escapeHtml(segment.value)}</${tag}>`;
    })
    .join('');

const reviewPage = (bundle: {
  readonly changeSet: DraftChangeSet;
  readonly comparison: ComparisonResult;
  readonly candidate: ClaimCandidate;
  readonly evidence: readonly EvidenceSpan[];
}): string => {
  const { changeSet, comparison, candidate, evidence } = bundle;
  const evidenceHtml = evidence
    .map(
      (item) =>
        `<li><code>${escapeHtml(item.evidenceId)}</code><blockquote>${escapeHtml(item.quote.exact)}</blockquote></li>`,
    )
    .join('');
  const activity = changeSet.decisions
    .map(
      (item) =>
        `<li>${escapeHtml(item.decision)} — ${escapeHtml(item.actor.id)} — ${escapeHtml(item.reason)}</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shotgun Change Set Review</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#1f2937}
    section{border:1px solid #d1d5db;border-radius:12px;padding:18px;margin:16px 0}
    code{overflow-wrap:anywhere} ins{background:#dcfce7;text-decoration:none} del{background:#fee2e2}
    textarea{width:100%;min-height:90px;box-sizing:border-box} button{margin:8px 8px 0 0;padding:10px 16px}
    blockquote{border-left:4px solid #cbd5e1;margin-left:0;padding-left:12px}
  </style>
</head>
<body>
  <h1>Change Set Review</h1>
  <p>상태: <strong id="status">${escapeHtml(changeSet.status)}</strong></p>
  <section>
    <h2>후보 Claim</h2>
    <p>${escapeHtml(candidate.claimText)}</p>
    <p>분류: ${escapeHtml(comparison.classification)} / 작업: ${escapeHtml(changeSet.operation)}</p>
  </section>
  <section>
    <h2>고정 Canonical Snapshot</h2>
    <p>버전 ${changeSet.expectedCanonicalVersion}</p>
    <code>${escapeHtml(changeSet.snapshotDigest)}</code>
    <p>${comparison.matchedClaim ? escapeHtml(comparison.matchedClaim.text) : '일치 후보 없음'}</p>
  </section>
  <section>
    <h2>Machine Diff</h2>
    <p>${diffHtml(comparison.diff)}</p>
    <code>${escapeHtml(changeSet.diffDigest)}</code>
  </section>
  <section>
    <h2>Evidence</h2>
    <ul>${evidenceHtml}</ul>
  </section>
  <section>
    <h2>Activity</h2>
    <ul id="activity">${activity || '<li>아직 결정 없음</li>'}</ul>
  </section>
  <section>
    <h2>결정</h2>
    <textarea id="reason" placeholder="승인·보류·거절 이유를 입력하세요"></textarea>
    <div>
      <button data-decision="APPROVE">승인</button>
      <button data-decision="HOLD">보류</button>
      <button data-decision="REJECT">거절</button>
    </div>
    <p id="message"></p>
  </section>
  <script>
    const changeSetId = ${JSON.stringify(changeSet.changeSetId)};
    const expectedContentDigest = ${JSON.stringify(changeSet.contentDigest)};
    document.querySelectorAll('button[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const csrfRes=await fetch('/auth/csrf');if(!csrfRes.ok)throw new Error('CSRF 갱신 실패');const csrf=(await csrfRes.json()).csrfToken;
          const response = await fetch('/reviews/decision', {
            method: 'POST',
            headers: {'content-type': 'application/json', 'x-csrf-token': csrf},
            body: JSON.stringify({
              changeSetId,
              expectedRevisionNumber: 1,
              expectedContentDigest,
              decision: button.dataset.decision,
              reason: document.querySelector('#reason').value
            })
          });
          const result = await response.json();
          document.querySelector('#message').textContent = response.ok
            ? '결정이 서버에 기록되었습니다.'
            : result.message;
          if (response.ok) document.querySelector('#status').textContent = result.changeSet.status;
        } catch (e) {
          document.querySelector('#message').textContent = e.message;
        }
      });
    });
  </script>
</body>
</html>`;
};

export const createApplication = async (options: ApplicationOptions = {}) => {
  const intakeRepository = options.intakeRepository ?? new InMemoryIntakeRepository();
  const originalAssetRepository =
    options.originalAssetRepository ?? new InMemoryOriginalAssetRepository();
  const assetStorage = options.assetStorage ?? new InMemoryAssetStorage();
  const transformationRepository =
    options.transformationRepository ?? new InMemoryTransformationRepository();
  const evidenceRepository = options.evidenceRepository ?? new InMemoryEvidenceRepository();
  const aiProviderRepository =
    options.aiProviderRepository ?? new InMemoryAIProviderCallRepository();
  const candidateRepository = options.candidateRepository ?? new InMemoryCandidateRepository();
  const validationRepository = options.validationRepository ?? new InMemoryValidationRepository();
  const comparisonRepository = options.comparisonRepository ?? new InMemoryComparisonRepository();
  const changeSetReviewRepository =
    options.changeSetReviewRepository ?? new InMemoryChangeSetReviewRepository();
  const canonicalKnowledgeRepository =
    options.canonicalKnowledgeRepository ?? new InMemoryCanonicalKnowledgeRepository();
  const searchProjectionRepository =
    options.searchProjectionRepository ?? new InMemorySearchProjectionRepository();
  const knowledgeModelRepository =
    options.knowledgeModelRepository ?? new InMemoryKnowledgeModelRepository();
  const compiledTruthRepository =
    options.compiledTruthRepository ?? new InMemoryCompiledTruthRepository();
  const actionExecutionRepository =
    options.actionExecutionRepository ?? new InMemoryActionExecutionRepository();
  const actionCandidateRepository =
    options.actionCandidateRepository ?? new InMemoryActionCandidateRepository();
  const actionConnector = options.actionConnector ?? new FakeDraftActionConnector();
  const authRepository = options.authRepository ?? new InMemoryAuthRepository();
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const testDevelopmentAuth =
    process.env.VITEST === 'true' && !options.authRepository && !production;
  let testPrincipal: Awaited<ReturnType<AuthRepositoryPort['authenticatePassword']>>;
  if (testDevelopmentAuth) {
    await authRepository.bootstrapOwner({
      accountId: 'test-owner',
      passwordHash: await hashPassword('test-owner-password'),
      projectId: 'shotgun',
      scopes: [
        'owner',
        'action:candidate:stage',
        'action:approve',
        'action:execute',
        'action:verify',
        'action:read',
        'action:audit:read',
      ],
      // Keep the test adapter aligned with the former no-header default.
      // Production never enables this adapter.
      sensitivityClearance: 'private',
    });
    testPrincipal = await authRepository.authenticatePassword('test-owner', 'test-owner-password');
  }
  const canonicalSnapshot = options.canonicalSnapshot ?? canonicalKnowledgeRepository;
  const textDiff = options.textDiff ?? new JsDiffAdapter();
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
  const transformer = options.transformer ?? new PythonDocumentFormatAdapter();
  const evidenceLocator = options.evidenceLocator ?? plainTextAdapter;
  const ping = createPingModule();
  const pong = createPongModule();
  const intake = createIntakeModule(intakeRepository);
  const originalAsset = createOriginalAssetModule(originalAssetRepository, assetStorage);
  const transformation = createTransformationModule(transformationRepository, transformer);
  const evidence = createEvidenceModule(evidenceRepository, evidenceLocator);
  const ai = createAIProviderModule(
    aiProviderRepository,
    aiProvider,
    options.aiProviderPolicy ?? {
      allowPrivate: aiProvider.identity.provider === 'fake',
      allowRestricted: false,
      maxAttempts: 2,
    },
  );
  const candidateGeneration = createCandidateGenerationModule(candidateRepository);
  const validation = createValidationModule(validationRepository);
  const comparison = createComparisonModule(comparisonRepository, canonicalSnapshot, textDiff);
  const changeSetReview = createChangeSetReviewModule(changeSetReviewRepository);
  const canonicalKnowledge = createCanonicalKnowledgeModule(canonicalKnowledgeRepository);
  const projectionSearch = createProjectionSearchModule(searchProjectionRepository);
  const citedAnswer = createCitedAnswerModule();
  const knowledgeModel = createKnowledgeModelModule(knowledgeModelRepository);
  const compiledTruth = createCompiledTruthModule(compiledTruthRepository);
  const actionExecution = createActionExecutionModule(
    actionExecutionRepository,
    actionCandidateRepository,
    {
      getValidationDigest: async (projectId, candidateId) => {
        const c = await actionCandidateRepository.find(projectId, candidateId);
        return c?.validationDigest;
      },
      getEvidenceSetDigest: async (projectId, candidateId) => {
        const c = await actionCandidateRepository.find(projectId, candidateId);
        return c ? actionEvidenceSetDigest(c.evidence) : undefined;
      },
      getSourceSensitivity: async (projectId, candidateId) => {
        const c = await actionCandidateRepository.find(projectId, candidateId);
        return c?.sourceSensitivity;
      },
    },
    actionConnector,
  );
  const kernel = new ShotgunKernel(options.transport ?? new InProcessTransport());
  kernel.register(
    ping.module,
    pong.module,
    intake,
    originalAsset,
    transformation,
    evidence,
    ai,
    candidateGeneration,
    validation,
    comparison,
    changeSetReview,
    canonicalKnowledge,
    projectionSearch,
    citedAnswer,
    knowledgeModel,
    compiledTruth,
    actionExecution,
  );
  await kernel.start();

  const server = Fastify({ logger: false });

  server.setErrorHandler(async (error, request, reply) => {
    if (!(error instanceof ShotgunError)) {
      return reply.status(500).send({ code: 'TERMINAL_FAILURE', message: 'Request failed.' });
    }
    const context = trustedRequestContexts.get(request.headers as object);
    try {
      await authRepository.appendAudit({
        principalId: context?.principalId,
        projectId: context?.projectId,
        event: `REQUEST_DENIED:${error.code}`,
      });
    } catch {
      // Do not replace a safe denial response with an audit-storage implementation error.
    }
    const status = ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_INVALID'].includes(error.code)
      ? 401
      : [
            'AUTHORIZATION_DENIED',
            'PROJECT_ACCESS_DENIED',
            'REQUEST_ORIGIN_DENIED',
            'POLICY_DENIED',
            'ACTION_AUTHORIZATION_DENIED',
            'ACTION_CONNECTOR_NOT_ALLOWED',
          ].includes(error.code)
        ? 403
        : ['NOT_FOUND', 'ACTION_REFERENCE_NOT_FOUND'].includes(error.code)
          ? 404
          : ['CONFLICT', 'STALE_VERSION', 'STALE_APPROVAL', 'STALE_ACTION_SNAPSHOT'].includes(
                error.code,
              )
            ? 409
            : [
                  'VALIDATION_ERROR',
                  'LEGACY_SECURITY_HEADER_FORBIDDEN',
                  'PROJECT_CONTEXT_REQUIRED',
                  'ACTION_SERVER_BINDING_REQUIRED',
                ].includes(error.code)
              ? 400
              : 500;
    return reply.status(status).send({
      code: error.code,
      message: error.safeMessage,
      correlationId: error.correlationId,
    });
  });

  const sessionCookieName = production ? '__Host-shotgun_session' : 'shotgun_development_session';
  const publicPaths = new Set(['/health', '/auth/login']);
  server.addHook('onRequest', async (request) => {
    if (publicPaths.has(request.url.split('?')[0] ?? request.url)) return;
    const headers = request.headers as SecurityHeaders;
    for (const name of ['x-project-id', 'x-actor-id', 'x-access-scope', 'x-sensitivity'] as const) {
      if (headers[name] !== undefined) {
        throw new ShotgunError({
          code: 'LEGACY_SECURITY_HEADER_FORBIDDEN',
          safeMessage: 'Legacy security headers are forbidden.',
          module: 'shotgun-app',
          operation: 'authenticate-request',
        });
      }
    }

    const authorization = headers.authorization;
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    let context: TrustedSecurityContext | undefined;
    if (bearer) {
      const principal = await authRepository.findApiToken(bearer);
      const projectId = headers['x-shotgun-project']?.trim();
      if (!principal)
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Credential is invalid, expired, or revoked.',
          module: 'shotgun-app',
          operation: 'authenticate-api-token',
        });
      if (!projectId)
        throw new ShotgunError({
          code: 'PROJECT_CONTEXT_REQUIRED',
          safeMessage: 'X-Shotgun-Project is required for API token requests.',
          module: 'shotgun-app',
          operation: 'select-project',
        });
      context = await authorize({
        repository: authRepository,
        principal,
        projectId,
        requiredScopes: [],
        tokenScopeCeiling: principal.scopeCeiling,
      });
    } else {
      const sessionToken = parseCookie(headers.cookie, sessionCookieName);
      if (!sessionToken && testPrincipal) {
        context = await authorize({
          repository: authRepository,
          principal: testPrincipal,
          projectId: 'shotgun',
          requiredScopes: [],
        });
      }
      if (!sessionToken && !context)
        throw new ShotgunError({
          code: 'AUTHENTICATION_REQUIRED',
          safeMessage: 'Authentication is required.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      if (context) {
        trustedRequestContexts.set(request.headers as object, context);
        return;
      }
      if (!sessionToken)
        throw new ShotgunError({
          code: 'AUTHENTICATION_REQUIRED',
          safeMessage: 'Authentication is required.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      const session = await authRepository.findSession(sessionToken);
      const principal = session
        ? await authRepository.findPrincipal(session.principalId, 'session', session.sessionId)
        : undefined;
      if (!session || !principal)
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Session is invalid, expired, or revoked.',
          module: 'shotgun-app',
          operation: 'authenticate-session',
        });
      if (isStateChanging(request.method)) {
        const csrf = headers['x-csrf-token'];
        if (!csrf || !session.csrfHash || hashSecuritySecret(csrf) !== session.csrfHash)
          throw new ShotgunError({
            code: 'REQUEST_ORIGIN_DENIED',
            safeMessage: 'A valid CSRF token is required.',
            module: 'shotgun-app',
            operation: 'verify-csrf',
          });
      }
      context = await authorize({
        repository: authRepository,
        principal,
        projectId: session.activeProjectId,
        requiredScopes: [],
      });
    }
    if (!context)
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: 'Project membership or authorization is missing.',
        module: 'shotgun-app',
        operation: 'authorize-request',
      });
    trustedRequestContexts.set(request.headers as object, context);
    await authRepository.appendAudit({
      principalId: context.principalId,
      projectId: context.projectId,
      event: 'REQUEST_AUTHORIZED',
    });
  });

  server.post<{ Body: { accountId: string; password: string; projectId: string } }>(
    '/auth/login',
    async (request, reply) => {
      const principal = await authRepository.authenticatePassword(
        request.body.accountId,
        request.body.password,
      );
      if (!principal) {
        await authRepository.appendAudit({ event: 'LOGIN_DENIED' });
        throw new ShotgunError({
          code: 'AUTHENTICATION_INVALID',
          safeMessage: 'Credential is invalid.',
          module: 'shotgun-app',
          operation: 'login',
        });
      }
      const context = await authorize({
        repository: authRepository,
        principal,
        projectId: request.body.projectId,
        requiredScopes: [],
      });
      if (!context)
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Project membership is missing.',
          module: 'shotgun-app',
          operation: 'login',
        });
      const session = await authRepository.createSession(
        principal.principalId,
        context.projectId,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      );
      await authRepository.appendAudit({
        principalId: principal.principalId,
        projectId: context.projectId,
        event: 'LOGIN_SUCCEEDED',
      });
      reply.header(
        'Set-Cookie',
        `${sessionCookieName}=${session.sessionToken}; HttpOnly; SameSite=Lax; Path=/${production ? '; Secure' : ''}`,
      );
      return {
        csrfToken: session.csrfToken,
        projectId: context.projectId,
        principalId: principal.principalId,
      };
    },
  );

  server.get('/auth/csrf', async (request, reply) => {
    const sessionToken = parseCookie(request.headers.cookie, sessionCookieName);
    if (!sessionToken) return reply.status(401).send({ message: 'Authentication required' });
    const session = await authRepository.findSession(sessionToken);
    if (!session) return reply.status(401).send({ message: 'Session invalid' });
    const newCsrf = randomUUID();
    await authRepository.updateSessionCsrf(sessionToken, newCsrf);
    return { csrfToken: newCsrf };
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/logout', async (request, reply) => {
    const context = requestContext(request.headers);
    if (context.authenticationMethod === 'session') {
      await authRepository.revokeSessions(context.principalId);
    }
    reply.header(
      'Set-Cookie',
      `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
    return { message: 'Logged out' };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/principal', async (request) => {
    const context = requestContext(request.headers);
    return { principalId: context.principalId, actor: context.actor };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/projects', async (request) => {
    const context = requestContext(request.headers);
    const memberships = await authRepository.listMemberships(context.principalId);
    return { projects: memberships.map((m) => m.projectId) };
  });

  server.post<{ Body: { projectId: string }; Headers: SecurityHeaders }>(
    '/auth/projects/active',
    async (request) => {
      const context = requestContext(request.headers);
      const membership = await authRepository.findMembership(context.principalId, request.body.projectId);
      if (!membership) throw new ShotgunError({ code: 'PROJECT_ACCESS_DENIED', safeMessage: 'Access denied.', module: 'shotgun-app', operation: 'set-active-project' });
      const sessionToken = parseCookie(request.headers.cookie, sessionCookieName);
      if (sessionToken) {
        await authRepository.updateSessionProject(sessionToken, request.body.projectId);
      }
      return { projectId: request.body.projectId };
    },
  );

  server.post<{ Body: { passwordHash: string }; Headers: SecurityHeaders }>('/auth/password', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.changePassword(context.principalId, request.body.passwordHash);
    return { message: 'Password updated' };
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/account/disable', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.disablePrincipal(context.principalId);
    return { message: 'Account disabled' };
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/sessions/revoke', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.revokeSessions(context.principalId);
    return { message: 'Sessions revoked' };
  });

  server.post<{ Body: { scopes: string[]; expiresAt: string }; Headers: SecurityHeaders }>('/auth/tokens', async (request) => {
    const context = requestContext(request.headers);
    const token = await authRepository.issueApiToken({
      principalId: context.principalId,
      scopes: request.body.scopes,
      expiresAt: request.body.expiresAt,
    });
    return token;
  });

  server.post<{ Headers: SecurityHeaders }>('/auth/tokens/revoke', async (request) => {
    const context = requestContext(request.headers);
    await authRepository.revokeApiTokens(context.principalId);
    return { message: 'Tokens revoked' };
  });

  server.get<{ Headers: SecurityHeaders }>('/auth/tokens', async (request) => {
    const context = requestContext(request.headers);
    const tokens = await authRepository.listApiTokens(context.principalId);
    return { tokens };
  });

  server.get('/health', async () => kernel.health());

  server.post<{ Body: PingRequest }>('/demo/ping', async (request) => {
    const requestId = request.body?.requestId ?? randomUUID();
    const context = requestContext(request.headers as SecurityHeaders);
    const command = createCommand({
      messageType: 'PingCommand',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      idempotencyKey: `ping:${requestId}`,
      ...context,
      payload: {
        requestId,
        message: request.body?.message ?? 'hello',
        sequence: 1,
      },
    });

    const commandDelivery = await kernel.connector.sendCommand(command);
    const query = createChildQuery(command, {
      messageType: 'GetPongResult',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      payload: { requestId },
    });
    const queryDelivery = await kernel.connector.query(query);

    return {
      commandStatus: commandDelivery.status,
      pong: queryDelivery.result.payload,
      trace: traceView(kernel, command.traceId),
    };
  });

  server.post<{ Body: SubmitIntakePayload; Headers: SecurityHeaders }>(
    '/intake',
    async (request) => {
      const context = requestContext(request.headers);
      const command = createCommand({
        messageType: 'SubmitIntake',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `intake:${context.projectId}:${request.body.submissionId}`,
        ...context,
        payload: request.body,
      });
      const commandDelivery = await kernel.connector.sendCommand(command);
      const resultQuery = createChildQuery(command, {
        messageType: 'GetIntakeResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        payload: { submissionId: request.body.submissionId },
      });
      const stored = await kernel.connector.query(resultQuery);
      const storedPayload = stored.result.payload as { readonly sourceVersionId: string };
      const document = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'GetDocumentRevision',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const evidence = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListEvidenceSpans',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const candidates = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListClaimCandidates',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const reviews = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListDraftChangeSets',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      return {
        commandStatus: commandDelivery.status,
        intake: commandDelivery.result,
        stored: stored.result.payload,
        document: document.result.payload,
        evidence: evidence.result.payload,
        candidates: candidates.result.payload,
        reviews: reviews.result.payload,
        trace: traceView(kernel, command.traceId),
        audit: auditView(kernel, command.traceId),
      };
    },
  );

  server.post<{ Body: ComparisonRequest; Headers: SecurityHeaders }>(
    '/comparisons/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetComparisonResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query<ComparisonResult>(query);
      return { comparison: delivery.result.payload };
    },
  );

  server.post<{ Body: ChangeSetRequest; Headers: SecurityHeaders }>(
    '/reviews/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetReviewBundle',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return { review: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/canonical/snapshot',
    async (request) => {
      const delivery = await kernel.connector.query<CanonicalSnapshot>(
        createQuery({
          messageType: 'GetCanonicalSnapshot',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { snapshot: delivery.result.payload };
    },
  );

  server.post<{ Body: SearchRequest; Headers: SecurityHeaders }>('/search', async (request) => {
    const delivery = await kernel.connector.query<CanonicalSearchResponse>(
      createQuery({
        messageType: 'SearchCanonicalKnowledge',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      }),
    );
    return { search: delivery.result.payload };
  });

  server.post<{ Body: AskRequest; Headers: SecurityHeaders }>('/ask/query', async (request) => {
    const delivery = await kernel.connector.query<CitedAnswer>(
      createQuery({
        messageType: 'AskCanonicalKnowledge',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      }),
    );
    return { answer: delivery.result.payload };
  });

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/projection/readiness',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetProjectionReadiness',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { readiness: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/projection/rebuild',
    async (request) => {
      const context = requestContext(request.headers);
      const command = createCommand({
        messageType: 'RebuildSearchProjection',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `projection-rebuild:${context.projectId}:${randomUUID()}`,
        ...context,
        payload: request.body ?? {},
      });
      const delivery = await kernel.connector.sendCommand(command);
      return { commandStatus: delivery.status, result: delivery.result };
    },
  );

  server.get('/ask', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(askPage()),
  );

  server.get<{ Params: EvidenceRequest; Headers: SecurityHeaders }>(
    '/evidence/:evidenceId',
    async (request, reply) => {
      const delivery = await kernel.connector.query<EvidenceSpan>(
        createQuery({
          messageType: 'GetEvidenceSpan',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.params,
        }),
      );
      const span = delivery.result.payload;
      return reply
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Evidence</title><body><h1>원문 근거</h1><blockquote>${escapeHtml(span.quote.exact)}</blockquote><dl><dt>Evidence ID</dt><dd>${escapeHtml(span.evidenceId)}</dd><dt>Source Version</dt><dd>${escapeHtml(span.sourceVersionId)}</dd><dt>Pointer</dt><dd>${escapeHtml(span.pointer)}</dd></dl></body></html>`,
        );
    },
  );

  server.post<{ Body: CanonicalClaimRequest; Headers: SecurityHeaders }>(
    '/canonical/claims/resolve',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetCanonicalClaim',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { claim: delivery.result.payload };
    },
  );

  server.post<{ Body: CanonicalCommitRequest; Headers: SecurityHeaders }>(
    '/canonical/commits/resolve',
    async (request) => {
      const delivery = await kernel.connector.query<CanonicalCommitResult>(
        createQuery({
          messageType: 'GetCanonicalCommit',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { commit: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/canonical/history',
    async (request) => {
      const delivery = await kernel.connector.query<{ items: readonly CanonicalHistoryEvent[] }>(
        createQuery({
          messageType: 'ListCanonicalHistory',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { history: delivery.result.payload };
    },
  );

  server.get<{ Params: ChangeSetRequest; Headers: SecurityHeaders }>(
    '/reviews/:changeSetId',
    async (request, reply) => {
      const query = createQuery({
        messageType: 'GetReviewBundle',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.params,
      });
      const delivery = await kernel.connector.query<{
        changeSet: DraftChangeSet;
        comparison: ComparisonResult;
        candidate: ClaimCandidate;
        evidence: readonly EvidenceSpan[];
      }>(query);
      return reply.type('text/html; charset=utf-8').send(reviewPage(delivery.result.payload));
    },
  );

  server.post<{ Body: ReviewDecisionRequest; Headers: SecurityHeaders }>(
    '/reviews/decision',
    async (request) => {
      const decisionId = request.body.decisionId ?? randomUUID();
      const command = createCommand({
        messageType: 'RecordReviewDecision',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `review-decision:${requestContext(request.headers).projectId}:${decisionId}`,
        ...requestContext(request.headers),
        payload: { ...request.body, decisionId },
      });
      const delivery = await kernel.connector.sendCommand<{
        changeSet: DraftChangeSet;
        manifest?: ApprovedChangeSetManifest;
      }>(command);
      return {
        commandStatus: delivery.status,
        changeSet: delivery.result.changeSet,
        manifest: delivery.result.manifest,
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/candidates/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListClaimCandidates',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        candidates: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: CandidateRequest; Headers: SecurityHeaders }>(
    '/validation/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetValidationResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        validation: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/documents/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetDocumentRevision',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        document: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/evidence/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListEvidenceSpans',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: EvidenceRequest; Headers: SecurityHeaders }>(
    '/evidence/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetEvidenceSpan',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: ResolveAssetRequest; Headers: SecurityHeaders }>(
    '/assets/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'ResolveAsset',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        resolved: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: KnowledgeStageRequest; Headers: SecurityHeaders }>(
    '/knowledge/groups/stage',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        createCommand({
          messageType: 'StageKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `knowledge-stage:${context.projectId}:${request.body.groupId}`,
          ...context,
          payload: request.body,
        }),
      );
      return { group: delivery.result };
    },
  );

  server.post<{ Body: KnowledgeReviewRequest; Headers: SecurityHeaders }>(
    '/knowledge/groups/review',
    async (request) => {
      const context = requestContext(request.headers);
      const decisionId = request.body.decisionId ?? randomUUID();
      const delivery = await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        createCommand({
          messageType: 'ReviewKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `knowledge-review:${context.projectId}:${decisionId}`,
          ...context,
          payload: { ...request.body, decisionId },
        }),
      );
      return { group: delivery.result };
    },
  );

  server.post<{ Body: { readonly groupId: string }; Headers: SecurityHeaders }>(
    '/knowledge/groups/resolve',
    async (request) => {
      const delivery = await kernel.connector.query(
        createQuery({
          messageType: 'GetKnowledgeGroup',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { review: delivery.result.payload };
    },
  );

  server.post<{ Body: KnowledgeImpactRequest; Headers: SecurityHeaders }>(
    '/knowledge/impact',
    async (request) => {
      const delivery = await kernel.connector.query<KnowledgeImpactResult>(
        createQuery({
          messageType: 'GetKnowledgeImpact',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { impact: delivery.result.payload };
    },
  );

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/knowledge/graph/query',
    async (request) => {
      const delivery = await kernel.connector.query<KnowledgeGraphView>(
        createQuery({
          messageType: 'GetKnowledgeGraph',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { graph: delivery.result.payload };
    },
  );

  server.get('/knowledge', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(knowledgePage()),
  );

  server.get('/vendor/cytoscape.min.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .send(await readFile(path.resolve('node_modules/cytoscape/dist/cytoscape.min.js'), 'utf8')),
  );

  server.post<{
    Body: { readonly mode: 'FULL_REBUILD' | 'INCREMENTAL' };
    Headers: SecurityHeaders;
  }>('/compiled-truth/build', async (request) => {
    const context = requestContext(request.headers);
    const delivery = await kernel.connector.sendCommand<CompiledTruthProjection>(
      createCommand({
        messageType: 'BuildCompiledTruth',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `compiled-truth:${context.projectId}:${request.body.mode}:${randomUUID()}`,
        ...context,
        payload: request.body,
      }),
    );
    return { projection: delivery.result };
  });

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/compiled-truth/query',
    async (request) => {
      const context = requestContext(request.headers);
      const projection = await kernel.connector.query<CompiledTruthProjection>(
        createQuery({
          messageType: 'GetCompiledTruth',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...context,
          payload: request.body ?? {},
        }),
      );
      const status = await kernel.connector.query<CompiledTruthProjectionStatus>(
        createQuery({
          messageType: 'GetCompiledTruthStatus',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...context,
          payload: {},
        }),
      );
      return { projection: projection.result.payload, status: status.result.payload };
    },
  );

  server.post<{
    Body: {
      readonly mode: 'INCREMENTAL' | 'WEEKLY';
      readonly maxNodes: number;
      readonly maxSuggestions: number;
    };
    Headers: SecurityHeaders;
  }>('/knowledge/discovery/run', async (request) => {
    const context = requestContext(request.headers);
    const delivery = await kernel.connector.sendCommand<DiscoveryRunResult>(
      createCommand({
        messageType: 'RunKnowledgeDiscovery',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `knowledge-discovery:${context.projectId}:${request.body.mode}:${randomUUID()}`,
        ...context,
        payload: request.body,
      }),
    );
    return { discovery: delivery.result };
  });

  server.post<{ Body: Record<string, never>; Headers: SecurityHeaders }>(
    '/knowledge/discovery/list',
    async (request) => {
      const delivery = await kernel.connector.query<{
        items: readonly DerivedInferenceCandidate[];
      }>(
        createQuery({
          messageType: 'ListDerivedInferences',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body ?? {},
        }),
      );
      return { inferences: delivery.result.payload.items };
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>('/actions/preview', async (request) => {
    const context = requestContext(request.headers);
    const payload = requireActionPreviewRequest(request.body);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'PrepareActionPreview',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-preview:${context.projectId}:${payload.candidateId}:${payload.expectedRevision}:${payload.operationKey}`,
        ...context,
        payload,
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: { readonly expectedPreviewDigest: string };
    Headers: SecurityHeaders;
  }>('/actions/:actionId/approve', async (request) => {
    const context = requestContext(request.headers);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'ApproveActionPreview',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-approve:${request.params.actionId}:${request.body.expectedPreviewDigest}:${context.actor.id}`,
        ...context,
        payload: { actionId: request.params.actionId, ...request.body },
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/actions/execute', async (request) => {
    const context = requestContext(request.headers);
    const payload = requireActionExecuteRequest(request.body);
    const delivery = await kernel.connector.sendCommand<ActionExecutionRecord>(
      createCommand({
        messageType: 'ExecuteApprovedAction',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `action-execute:${payload.approvalId}`,
        ...context,
        payload,
      }),
    );
    return { action: delivery.result };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: Record<string, never>;
    Headers: SecurityHeaders;
  }>('/actions/:actionId/query', async (request) => {
    const delivery = await kernel.connector.query<ActionExecutionRecord>(
      createQuery({
        messageType: 'GetActionExecution',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: { actionId: request.params.actionId },
      }),
    );
    return { action: delivery.result.payload };
  });

  server.post<{
    Params: { readonly actionId: string };
    Body: Record<string, never>;
    Headers: SecurityHeaders;
  }>('/actions/:actionId/audit', async (request) => {
    const delivery = await kernel.connector.query<{ items: readonly ActionAuditEvent[] }>(
      createQuery({
        messageType: 'ListActionAudit',
        schemaVersion: '1.1.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: { actionId: request.params.actionId },
      }),
    );
    return { audit: delivery.result.payload.items };
  });

  server.post<{ Body: EntityVaultStageRequest; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/stage',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'StageEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `entity-vault-stage:${context.projectId}:${request.body.importId}`,
          ...context,
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result };
    },
  );

  server.post<{ Body: EntityVaultReviewRequest; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/review',
    async (request) => {
      const context = requestContext(request.headers);
      const delivery = await kernel.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'ReviewEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          idempotencyKey: `entity-vault-review:${context.projectId}:${request.body.importId}:${request.body.decision}`,
          ...context,
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result };
    },
  );

  server.post<{ Body: { readonly importId: string }; Headers: SecurityHeaders }>(
    '/knowledge/entity-vault/resolve',
    async (request) => {
      const delivery = await kernel.connector.query<EntityVaultImport>(
        createQuery({
          messageType: 'GetEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          ...requestContext(request.headers),
          payload: request.body,
        }),
      );
      return { stagedImport: delivery.result.payload };
    },
  );

  server.addHook('onClose', async () => {
    await kernel.shutdown();
    await options.closeResources?.();
  });

  return {
    server,
    kernel,
    repositories: {
      intake: intakeRepository,
      originalAsset: originalAssetRepository,
      transformation: transformationRepository,
      evidence: evidenceRepository,
      aiProvider: aiProviderRepository,
      candidates: candidateRepository,
      validation: validationRepository,
      comparisons: comparisonRepository,
      reviews: changeSetReviewRepository,
      canonical: canonicalKnowledgeRepository,
      projection: searchProjectionRepository,
      knowledge: knowledgeModelRepository,
      compiledTruth: compiledTruthRepository,
      actionCandidates: actionCandidateRepository,
      actions: actionExecutionRepository,
    },
    storage: assetStorage,
    state: {
      ping: ping.state,
      pong: pong.state,
    },
  };
};
