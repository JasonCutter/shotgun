# ADR-173 게시 보안 Gate 수정 — 2026-10-11

## 권한과 범위

사용자는 저장소 정합성·미게시 작업 감사를 승인하면서 PR #380의 기존 보안 취약점 CI 실패 해결을 명시적으로 포함했다. main 직접 push·merge·운영 변경·중단된 실험 재개는 승인되지 않았다.

기존 게시 head `43548b4a9428e6f172cedc7c1dd87875e14070d5`의 [CI](https://github.com/JasonCutter/shotgun/actions/runs/38060961261)는 source-map-js 1.2.1 감사에서 실패했다. 이전 문서의 의존성 불변 증명은 그 head의 이력이다. 이번 수정은 다음 보안 패치만 추가하며 기존 운영 코드·정책·워크플로·실험·stash를 보존한다.

## OSS 결정

- 결정: `ADOPT` — 이미 사용하는 upstream의 보안 패치. 새로운 runtime·Port·Adapter는 도입하지 않는다.
- 공식 저장소: [7rulnik/source-map-js](https://github.com/7rulnik/source-map-js).
- 버전·tag: `1.2.2` / `v1.2.2`.
- release commit: `0a1d334fd1e55a47df97fcd60a7915d46df3b08a`.
- 보안 수정 commit: `cf7658058ceeaa8619d5ae0ec90be6905209d016`.
- 라이선스: `BSD-3-Clause`, 기존 라이선스 유지.
- [공식 advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): CVE-2026-93749; 1.2.2가 patched version이다.
- [공식 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)는 indexed source map DoS 수정과 CSP 관련 수정을 명시한다. 공개 수정·release·npm integrity를 확인했다. 장기 유지보수 보증으로 해석하지 않는다.
- 대상: frontend build·PostCSS·jsdom의 기존 전이 의존성. SourceVersion/Evidence·Canonical·모델/의미 정책과 무관하다.
- 구현: `package.json` override를 정확히 1.2.2로 고정하고 lockfile의 해당 항목 version/resolved/integrity만 갱신.
- lock integrity: `sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==`.
- Role Matrix: 기능·역할 변경이 없어 갱신하지 않는다. 별도 전역 엔진이나 새 라이브러리 대체는 없다.
- Migration: 데이터 migration 없음. 기존 lockfile과 npm ci를 사용한다.
- Rollback: 이 수정 커밋을 revert할 수 있지만 1.2.1 복귀는 알려진 취약점과 감사 실패를 재도입하므로 일반 출시 rollback으로 권장하지 않는다.
- Replacement: 다음 advisory/의존성 major 변경 시 정확한 버전과 frontend build·unit·E2E 검증을 다시 수행한다.

## 무결성과 검증

`audit-development-strategy.ts`는 운영 코드·테스트·워크플로 불변 검사를 유지하고, 별도 `dependencyChanges`에 이 보안 패치를 기록한다. manifest에서 정확한 override 하나를 제거하면 원본과 같고, lockfile에서 해당 항목의 세 필드를 원복하면 원본 전체와 같아야 한다. 임의 버전·추가 dependency 변경을 허용하지 않는다.

`npm ci --ignore-scripts`와 `npm run oss:audit`는 성공했고 취약점 0건을 보고했다. 오프라인 source-map smoke 검증에서 큰 offset(10000001)·음수·소수 입력은 거부됐고 정상 mapping round-trip은 통과했다. 문서 검증(624 relative links)·typecheck·audit-script lint를 통과했다. 최종 exact-head Quality·Frontend·Required Gates 결과와 검증 로그는 PR #380 및 저장소 감사 보고서에서 별도로 보고한다. CI 이전 검사를 최종 CI 통과로 해석하지 않는다.

기존 동결 기록·보존 stash·원본 로컬 VP 커밋은 수정하지 않았다. 이 보안 Gate 수정은 ADR-173의 main 병합이나 VP-05/VP-06 완료 승인이 아니다.
