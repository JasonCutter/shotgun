# Shotgun V1.0

**자료를 넣고 질문하면, 원문 근거와 함께 답하는 로컬 개인 지식 시스템입니다.**

Shotgun은 자료의 원본과 변경 이력을 보존하고, 근거가 연결된 지식을 자동으로 정리합니다.
사용자는 개별 지식이나 AI 판단을 일일이 검토·승인할 필요 없이 **자료 투입 → 질문**의 두 동작으로 사용합니다.

## 현재 버전

**V1.0 · Application version `1.0.0` · VP 제품 인수 완료**

2026-10-20 사용자 결정에 따라 VP 완료 제품을 Shotgun V1.0으로 명명합니다.
Windows 설치·정상 실행·재부팅/복구 검증과 실제 AI를 사용한 자료 A/B/수정본·질문·인용 여정을 포함합니다.
이는 아래에 명시한 제품 범위의 완료이며, AI의 모든 의미 판단이 정확하다는 인증은 아닙니다.

- [V1.0 릴리스 범위·검증·제한](docs/implementation/releases/v1.0.0.md)
- [VP 완료 현황과 증거](docs/implementation/vp-completion-tracker.md)

## 무엇을 할 수 있나요?

| 동작           | 제품 동작                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 자료 투입      | 텍스트·파일·URL을 등록하고 원본과 출처를 보존합니다.                                                   |
| 자동 지식화    | 주장을 추출하고, 정책과 예산 안에서 중복·관계·충돌을 처리합니다. 판단이 부족하면 보류 상태를 남깁니다. |
| 질문           | 접근 가능한 자료에서 근거를 찾아 출처가 연결된 답변을 제공합니다.                                      |
| 자료 수정      | 새 SourceVersion을 생성하고, 새 질문에는 현재 버전의 근거를 사용합니다.                                |
| 과거 답변 확인 | 당시 답변과 인용은 보존하며, 근거가 교체됐다면 오래된 답변이라는 표시를 제공합니다.                    |
| 상태 확인      | 대기·처리 중·실패·판단 보류를 성공과 구분합니다.                                                       |
| 안전한 운영    | 프로젝트 권한·민감도·호출 예산·실행 이력·중복 방지·백업/복구 경계를 적용합니다.                        |

로컬 앱과 저장소를 사용하지만 **AI 분석·답변은 설정된 외부 AI Provider를 호출할 수 있습니다.**
자료의 외부 전송은 Provider 설정, 권한, 개인정보/민감도 정책과 실행 예산의 적용을 받습니다.

## 자료 형식과 범위

- 텍스트·문서: TXT, Markdown, HTML, PDF, DOCX, CSV, XLSX, PPTX.
- URL: 지원되는 웹 문서의 수집·변경 감지와 버전 갱신.
- 이미지: PNG/JPEG 원본 보존 및 별도 인가된 이미지 분석 경로. 생성된 설명은 **미검증 AI 관측**이며 원문 인용이나 사실로 자동 승격하지 않습니다. 분석 경로는 격리 인수로 검증했으며, 별도 승인 전 일반 운영에서는 OFF로 유지합니다. 실제 분석에는 Provider·정책 구성이 필요합니다.
- 오디오·영상의 일반 제품 처리는 V1.0 지원 범위에 포함하지 않습니다.

파일 접수 한도는 현재 **파일당 10 MiB**입니다. 형식별 변환 결과는 문서 구조에 따라 달라지며,
복잡한 PDF 수식·글리프·배치의 완전한 복원이나 모든 문서의 의미 추출 정확도를 보장하지 않습니다.

## 실행

현재 검증된 Windows 사용 형태는 **소스 설치 + Shotgun 바로가기**입니다.
범용 Windows 설치 프로그램이나 다중 사용자 공개 서비스 배포를 제공한다는 의미는 아닙니다.

### 이미 설치한 경우

Windows의 **Shotgun 바로가기**로 실행합니다. 일반 사용에는 별도의 Vite 개발 서버가 필요 없습니다.
기본 주소는 `http://127.0.0.1:3000`이며 Backend와 빌드된 화면을 같은 주소에서 제공합니다.

### 새 개발·개인 설치 환경

필요한 환경:

- Node.js 24 이상, npm 11 이상
- Python 3.12와 고정된 문서 변환 의존성
- Docker와 PostgreSQL/pgvector
- DB·원본 저장소·보안 설정. AI 사용 시 인가된 credential·Provider·정책·전역 예산 설정

[환경 준비](docs/engineering/stage-0-development.md)와 [.env.example](.env.example)을 확인한 뒤 **새 환경에서** 실행합니다.
기존 운영 DB에 초기화/reset 명령을 실행하지 마세요.

```bash
python -m pip install -r adapters/document-format-python/requirements.lock
python -m pip install -r adapters/networkx-impact-oracle/requirements.lock

# 의존성 설치 → DB 준비 → migration → 검증
npm run bootstrap

# 화면 빌드 → DB 검증 → 앱 시작 → readiness → 브라우저 열기
npm run launch

# 브라우저 자동 열기 없이 실행
npm run launch -- --no-open
```

`launch`는 DB를 자동 생성하거나 초기화하지 않습니다. AI 권한이나 설정이 없을 때 이를 우회해 호출하지 않습니다.
상세 실행 계약은 [Local Launch](docs/implementation/local-launch-serving-usability-implementation-request-260810001.md)를 참고하세요.

## 백업과 복구

```bash
npm run backup:create
npm run backup:list -- --verify
npm run backup:verify -- --latest

# 현재 DB를 덮어쓰지 않는 격리 복원
npm run backup:restore-safe -- --latest
```

기본 백업 위치는 사용자 홈의 `Shotgun Backups`입니다. 백업에는 개인 원문·지식 데이터가 포함될 수 있으므로 공개하지 마세요.
비밀 키는 백업에 포함되지 않으며 별도 안전 보관이 필요합니다.
백업·복구 절차는 [Runbook](docs/engineering/stage-12-1-backup-restore-runbook.md),
삭제 이력 journal과 복원 차단 계약은 [ADR-171](docs/architecture/adr/ADR-171-t3-project-source-knowledge-reset.md)을 따릅니다.
자동 백업 주기나 자동 retention이 기본으로 설정되는 것은 아닙니다.

## 검증 범위와 알려진 제한

- 실제 application·worker·PostgreSQL·Ask 경로의 인수와 권한·복구·실행 안전 검증을 완료했습니다.
- 실제 AI 인수 여정에서 새 자료 추가·수정, 현재 인용, 과거 답변 보존과 `stale` 표시를 확인했습니다.
- 이 인수 결과는 모든 자료에 대한 정확도 보장이 아닙니다. **독립 인증 Gold 기반의 모집단 Precision/Recall·Calibration은 미인증/N/A**입니다.
- 높은 confidence나 관계 채택은 객관적 사실 인증이 아닙니다. 생성 답변·관계·이미지 설명은 원문 근거와 함께 판단해야 합니다.
- 개발용 실험 코드는 제품의 기본 활성 기능이 아닙니다.
- 기존 Discovery·외부 Action 등 아키텍처 기록의 모든 계획을 V1.0의 기본 활성 기능으로 광고하지 않습니다.

## 개발과 검증

개발 화면을 별도로 실행하려면 두 터미널에서 `npm run dev`와 `npm run dev:web`을 사용합니다.
Vite 기본 주소는 `http://127.0.0.1:5173`, Backend는 `http://127.0.0.1:3000`입니다.

```bash
npm run docs:validate
npm run test:quick
npm run test:ci
npm run typecheck
npm run lint
npm run format:check
```

PostgreSQL 테스트와 Frontend E2E는 **격리 테스트 DB**에서 수행합니다.
GitHub CI의 Quality·Frontend·Required Gates가 공식 통합 검증을 수행합니다.
정확한 완료 근거와 이전 실패·제한은 릴리스 기록과 원래 검증 문서에서 확인할 수 있습니다.

## 설계와 기록

문서 Canonical은 이 GitHub 저장소의 **`main`**입니다. 승인·로컬 검증·PR·병합·배포는 구분합니다.
과거 Stage/Phase 계획은 개발 이력이며 최신 제품 상태를 대신하지 않습니다.

- [Canonical 정책](docs/CANONICAL.md)
- [ADR-172: VP 지식 권위](docs/architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md)
- [ADR-173: 제품 우선 개발·평가 신뢰성](docs/architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)
- [구현계획과 현재 제품 경로](docs/implementation/README.md)
- [Module Architecture](docs/architecture/module-architecture/README.md)
- [ADD](docs/architecture/add/README.md) · [ADR Registry](docs/architecture/adr/README.md)
- [릴리스 전략](docs/implementation/release-strategy.md)

GitHub 저장소는 공개입니다. 운영 자료·DB 덤프·백업·credential·`.env`는 공개 저장소에 올리지 않습니다.

Shotgun이라는 이름은 한 점에 모인 지식이 여러 방향의 연결과 활용으로 이어진다는 뜻입니다.
