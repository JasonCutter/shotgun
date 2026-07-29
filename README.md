# Shotgun

Shotgun은 한 점에 모인 지식이 산탄총의 탄환처럼 여러 방향으로 퍼져 나가며,
새로운 연결·행동·콘텐츠를 만들어 내는 개인 지식 시스템입니다.

## 현재 단계

- Stage 12까지 완료되어 독립 Module Package, Assembly Manifest와 OSS Adapter 교체까지 검증된 상태
- 최종 순서도 기준본: `docs/SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html`
- Knowledge Flow Detailed Map: [`docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md`](docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md)
- Phase 1–6 ADD: [`docs/architecture/add/README.md`](docs/architecture/add/README.md)
- Frontend Architecture: [`docs/architecture/frontend/README.md`](docs/architecture/frontend/README.md)
- 전역 ADR Registry: [`docs/architecture/adr/README.md`](docs/architecture/adr/README.md)
- Stage 12.1 기록 분류: [`docs/architecture/stage-12-1/README.md`](docs/architecture/stage-12-1/README.md)
- Engineering Evidence 분류: [`docs/engineering/README.md`](docs/engineering/README.md)
- Generated Artifact Ownership: [`docs/governance/generated-artifact-ownership.md`](docs/governance/generated-artifact-ownership.md)
- 상세 아키텍처 참고: `docs/shotgun_reference_architecture_strategy_ko.html`
- 모듈 아키텍처 기준선: `docs/architecture/module-architecture/README.md`
- 구현계획 기준선: `docs/implementation/README.md`
- 우선순위는 복잡한 전체 구조보다 작동하는 MVP 완성
- 원본 접수부터 Claim Canonical·인용 답변, Rich Knowledge·Compiled Truth와 Risk·Preview·Approval·Preflight·Verify Action 흐름까지 지원

## 문서 Canonical 운영

Project Shotgun의 유일한 문서 Canonical 권한은 GitHub 저장소 `JasonCutter/shotgun`의 `main` 브랜치입니다.

- Canonical 정책: [`docs/CANONICAL.md`](docs/CANONICAL.md)
- Canonical Manifest: [`docs/canonical-manifest.yaml`](docs/canonical-manifest.yaml)
- 최초 전환 결정: [`ADR-117`](docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md)
- Cutover 활성화 및 레거시 이관 경계: [`ADR-120`](docs/architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md)
- ADR 번호·중복·소유권 경계: [`ADR-121`](docs/architecture/adr/ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md)
- 이관 계획과 잔여 작업: [`docs/governance/documentation-sot-cutover-plan-260728001.md`](docs/governance/documentation-sot-cutover-plan-260728001.md)
- 현재 상태: **GitHub `main` Canonical active / documentation governance complete / final inventory pending**

Notion은 Candidate 작업 공간·미러·탐색 허브·Legacy Reference·기록 보관소이며, Google Drive 등 외부 저장소는 Reference 또는 Archive입니다. 외부에만 있는 문서는 Git PR로 이관·검토·승인·병합되기 전에는 새로운 구현을 지배하는 Canonical 문서가 아닙니다.

모든 보고서, 감사 결과, 검사 결과, 테스트 결과, 검증 기록 및 완료 증거는 Git으로 추적되는 저장소 문서로 기록합니다.

### 문서 검증

```bash
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

`docs:validate`는 Quality CI의 필수 Step이며 상대 링크, ADR 소유권, Canonical·Evidence·Generated Registry와 이관 Drift를 검사합니다.

## 개발 시작

개발 환경은 [Stage 0 문서](docs/engineering/stage-0-development.md)를 따르고,
Kernel 사용법은 [Stage 1 문서](docs/engineering/stage-1-kernel-runtime.md), 원본 접수와
Asset Resolver는 [Stage 2 문서](docs/engineering/stage-2-intake-original-asset.md), 검색과 인용 답변은
[Stage 7 문서](docs/engineering/stage-7-cited-search.md), Rich Knowledge와 Impact는
[Stage 9 문서](docs/engineering/stage-9-knowledge-model.md), 안전한 외부 Action은
[Stage 11 문서](docs/engineering/stage-11-risk-controlled-external-action.md), 모듈 재사용은
[Stage 12 문서](docs/engineering/stage-12-module-reuse-validation.md)에서 확인합니다.

### Bootstrap

```bash
# 기본: npm ci → DB 기동·대기 → migrate → verify
npm run bootstrap

# DB 작업 없이 의존성만 설치
npm run bootstrap:quick

# 의존성 설치 없이 DB만 준비
npm run bootstrap -- --skip-install

# 명시적으로만 파괴적 DB reset 실행
npm run bootstrap:reset
```

`--skip-db`와 `--reset-db`는 함께 사용할 수 없으며, 알 수 없는 옵션이나 하위 명령 실패는 즉시 오류로 종료됩니다.

### 테스트 모드

```bash
# 빠른 로컬 피드백: unit + contract + architecture
npm run test:quick

# CI 기준: unit + contract + integration + architecture + Stage 12 package
npm run test:ci
```

`npm test`는 CI 기준 범위를 유지하며 `test:ci`를 실행합니다.

### Frontend Section 1 로컬 개발

두 터미널에서 Backend와 독립 Frontend를 각각 실행합니다.

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run dev:web
```

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:3000`

Section 1은 Local Loopback Development 전용입니다. Production SPA Serving은 아직 구현되지 않았습니다.

## MVP 목표

1. 지식 원본을 등록합니다.
2. 근거가 연결된 Fact와 Claim을 저장합니다.
3. 관련 지식을 연결하고 탐색합니다.
4. 검토된 지식에서 행동과 콘텐츠를 생성합니다.

## 이름의 의미

**Shotgun**은 지식이 한 점에만 머무르지 않고, 산탄총의 탄환처럼 여러 방향으로
확산되어 새로운 지식 연결과 실제 활용으로 이어진다는 의미입니다.

## 공개 범위

이 프로젝트는 비공개 저장소로 운영합니다.
