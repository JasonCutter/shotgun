# ADR-173 원격 검토 브랜치 게시 검증

> 사용자 승인: 원격 검토 브랜치 push + PR 생성. main 직접 push와 PR merge는 승인되지 않음.

## 원본과 게시 계보

원본은 `1a36c7b55562783372dbc73c3188b9d797737c7e`다. 원래 branch 전체는 main보다 69 commits 앞서 있어 선택된 strategy commit만 main `e08449982cbf2247b9b1e7a7ef39281eab09166a` 위에 cherry-pick했다. 앞선 68개 runtime/실험 commits를 이 PR에 포함하지 않았다.

main에는 로컬 ADR-172 §13, 평가 보고서와 evaluator module이 없으므로 [게시 범위](./publication-notes.md)를 명시하고 참조 및 read-only audit를 portable하게 정비했다. 새 exact head는 이 문서의 원본 source SHA와 다르며 PR과 완료 응답에서 보고한다. 원본 commit/history를 rebase·삭제하거나 stash를 pop하지 않았다.

[원래 로컬 보고](./original-local-report.md)와 [원래 로컬 audit](./original-local-alignment-audit.json)는 source commit에서 복사한 byte-identical snapshot이다. 이 기록의 696-link 검증 및 로컬 production semantic digest는 원래 VP 기준선의 검증이고 새 main 기준선의 검증이라고 재표현하지 않는다.

## 변경·보존 범위

- ADR-173, ADR-098/172의 한정 전략 amendment, ADD/계획/로드맵/평가/DoD/AGENTS/registry 정비를 게시한다.
- 기존 production directories, tests, workflows, dependency/lockfile와 기존 scripts는 main parent와 동일하다. 새 audit script는 read-only 문서 검증용이다.
- 실제 main worker policy는 v6다. v11/global authority/Frontier 구현은 로컬 보존 기준선이며 이 PR에서 main에 통합·활성화하지 않는다.
- 원래 VP worktree는 `1a36c7b55`에서 clean이다. 원본 동결 raw/scores/evaluator/policy file SHA와 stash의 20개 file SHA를 원래 worktree에서 검증했다. B v2 stash도 유지했다.
- strategy source-proposal 사본 SHA `9fdf257d810cd3e12ee8b1cb60f871c46a7a27729d8971ea0dc65e196d562925`는 유지한다.

main code tree 보호 digest: `0acd2ac8ce0a0526310b0869d085f1e7ecca843ef2566f131143956171c35cc5` (Git tree entries SHA-256; production/tests/workflows/dependencies 범위). [현재 audit](./alignment-audit.json)은 원래 로컬 snapshot과 이 게시 기준선을 구분한다.

## 검증과 CI 보고

새 체크아웃의 docs validation은 상대 링크 623개, ADR owner 1–173, Canonical/generated/evidence/drift/Frontend governance를 통과했다. Typecheck와 audit-script lint를 통과했고 전체 format gate도 게시용 수정 이후 통과했다. CI 결과는 PR의 **exact head**에 연결된 run/check로 보고하며 이전 source commit의 결과를 대체하지 않는다.

`npm audit`은 변경하지 않은 main lockfile의 `source-map-js@1.2.1` high advisory를 보고했다. 패치 버전은 1.2.2다. [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). 이 전략 문서 게시 승인을 dependency/runtime 변경 또는 보안 Gate 완화 승인으로 해석하지 않아 lockfile을 수정하지 않았다. 실제 CI의 통과/실패와 실패 단계는 run 완료 후 PR 및 완료 응답에서 기록한다.

재현:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/audit-development-strategy.ts
node node_modules/tsx/dist/cli.mjs scripts/audit-development-strategy.ts --source-worktree C:\Users\lhm24\.codex\worktrees\vampire-vp\shotgun
npm run docs:validate
npm run typecheck
npm run format:check
```

기본 audit는 PC Downloads나 로컬 stash를 필수 의존으로 요구하지 않는다. 두 번째 명령만 원래 worktree의 실제 source/stash 보존을 검사한다. 그 결과를 문서 생성 기본값과 독립적으로 보고할 수 있다.

운영 데이터·정책 변경, 실호출, 기존 실험 재판정, Gold-B-7, VP-06, main 직접 push와 merge는 수행하지 않는다. PR 게시와 CI 성공도 Canonical main publication 또는 VP 제품 Gate 완료를 의미하지 않는다.
