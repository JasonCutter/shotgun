# Pre-Section 3 Engineering Foundation

> 상태: Implementation Candidate
> 기준일: 2026-07-28
> 관련 결정: Developer Workflow Contract, CI·Merge Governance Contract

## 범위

- 비파괴 기본 Bootstrap과 명시적 DB Reset
- `--skip-db`, `--skip-install`, `--reset-db`, `--help`
- `test:quick`, `test:ci`, 기존 `npm test` CI 범위 보존
- GitHub Actions concurrency, timeout, named steps
- `CI / Required Gates` Aggregator

## 구현 경계

- Product Domain·Frontend 기능은 변경하지 않는다.
- Database Migration은 추가하지 않는다.
- `quality:gate`는 `stage12:reuse-operations-gate` 내부에서만 실행한다.
- Branch Protection Ruleset은 저장소 외부 설정이며 이 PR에서 직접 적용하지 않는다.

## 검증

PR CI에서 다음을 확인한다.

- Bootstrap Unit Test
- Lint·Format·Typecheck
- `test:ci`
- Stage 12 Reuse and Operations Gate
- Database Test
- Frontend Typecheck·Test·Build·E2E
- Required Gates Aggregator

## 알려진 제한

현재 실행 환경에는 GitHub CLI와 저장소 Clone용 외부 네트워크가 없어 로컬 명령 실행 증거는 없다. 최종 검증 근거는 이 Branch의 GitHub Actions 결과로 확정한다.
