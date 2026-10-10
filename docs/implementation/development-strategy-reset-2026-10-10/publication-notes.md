# ADR-173 GitHub 검토 게시 범위

## 승인과 계보

사용자는 로컬 `1a36c7b55562783372dbc73c3188b9d797737c7e`의 전략 정비 변경을 원격 검토 브랜치에 push하고 PR을 생성하도록 승인했다. main 직접 push와 merge는 승인되지 않았다.

원래 VP 브랜치는 `origin/main@e08449982cbf2247b9b1e7a7ef39281eab09166a`보다 69 commits 앞서 있었다. 전략 commit 이전 68개에는 runtime·DB adapter·평가/실험 변경이 있으므로 이 PR에서는 제외했다. strategy commit만 독립 브랜치에 cherry-pick하고 게시 기준선에 맞는 문서 참조와 read-only audit portability를 정비했다. 원본 branch/head와 stash는 유지한다.

## 로컬 상태와 main 구현의 구분

- 원본 전략·자료의 기준은 로컬 VP lineage의 승인된 v11 및 global authority/Frontier 구현이다.
- 원격 main의 실제 app relation policy binding은 v6다. 이 PR은 main의 실행 code를 수정하거나 v11/global authority/Frontier 구현을 통합하지 않는다.
- 로컬 ADR-172 §13과 acceptance contract v1.0은 이 PR의 parent main에 없다. 절 번호/threshold 참조는 로컬 기준선의 보존 요구로 읽는다. 이 전략 PR을 runtime closure나 새 Frontier contract 전체의 승인으로 해석하지 않는다.
- 기존 Source/Evidence·VP Ledger·권한·Claim/Fact·복구·예산 경계의 보존과 제품/평가 우선순위는 ADR-173의 결정이다. 구체적 runtime 통합은 별도 검토 대상이다.

## 미게시 로컬 평가 증거 출처

로컬 commit `6be130125d211ac4da6d45a29fd1db101387a296`의 `docs/implementation/ssc-rel-0-1-review/reference-audit-report.md`는 72쌍 중 CANDIDATE 30쌍, 나머지 42쌍의 조사된 독립 승인 기록 미확인, QUALIFIES/NONE 3쌍과 합성 direction/stability 지표 문제를 보고했다. 새 독립 의미 Gold 승인 또는 모든 72쌍의 오답 판정이 아니다.

동결 A/B는 experiment `412c1240-7804-4c49-8c8c-f4099e9a5f40`, 432 terminal outcomes, evidence-file SHA `b980cf9063cf6041c1511c9c3e39ccfb7942a79b3c86d5fec01fd0a25c76f929`다. B v1은 experiment `22ae9ead-090d-4080-814f-19e317db67e0`, 12/36 중지, evidence-file SHA `3303be8de9e829216956caa00a12e6521060a77eb79a599fceb10bb1a7fb3784`다. 이 PR은 원본 raw/score/annotation을 새로 게시하거나 재판정하지 않는다.

[원래 로컬 감사 snapshot](./original-local-alignment-audit.json)과 [원래 로컬 보고](./original-local-report.md)는 선택된 commit의 byte-identical 기록이다. snapshot에 있는 production semantic digest `996ad83ba1fd74e8b50c07ed0811adbe8a4e7e6a1b801c893c251929615bf463`는 **그 로컬 기준선**의 digest이고 현재 main runtime의 digest라고 제시하지 않는다.

[paused-drafts manifest](./paused-drafts.json)의 stash는 로컬 복구 자료다. GitHub clone에 stash 존재를 요구하거나 그 내용을 commit/push하지 않는다. 실제 보존 상태는 원래 worktree에서 별도로 검증한다. 새로운 체크아웃에서는 [게시용 audit](./alignment-audit.json)이 문서 범위·main code tree 보존·원본 snapshot/source SHA를 확인한다.

## 게시용 정비 내용

1. 누락된 로컬 감사 문서 링크는 이 provenance 안내로 대체했다.
2. main ADR-172의 기존 본문 뒤에 전략 amendment만 추가했다. 기존 main에 없는 로컬 Frontier 상세 계약을 복사하지 않았다.
3. audit script는 main에 없는 evaluator module, PC Downloads, GitHub에 없는 stash를 필수 의존으로 삼지 않는다. 로컬 보존 검사는 명시적 `--source-worktree` 인자로 별도 실행한다.
4. 기존 로컬 보고/감사를 snapshot으로 보존하고 현재 PR 기준선 검증과 구분한다.

평가 reference 승격, 실호출, 운영 정책/데이터 변경, Gold-B-7 개봉, VP-06, main push와 merge는 이번 승인 범위가 아니다. PR exact head와 CI 결과는 GitHub PR 및 완료 응답에서 보고한다.
