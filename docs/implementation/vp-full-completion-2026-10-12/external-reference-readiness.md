# VP-05 — 외부 Reference 원본 및 검증 범위 확보

- Record: `VP05-EXTERNAL-REFERENCE-READINESS-20261014`
- Subject: Canonical `85e3a88a3be010c047fe32d6b917bcef70635837`, tree `678640b5b7aae147f32edd736440475461292f37`
- Status: **LOCAL EVIDENCE / SHOTGUN CERTIFICATION BLOCKED**. 전체 VP 인수 완료 아님
- Authority: [전체 연속 실행 지시](./execution-directive.md), ADR-173, 보정 [A1](../../architecture/add/vp05-evaluation-trust/a1-reference-review-responsibility.md), [A2](../../architecture/add/vp05-evaluation-trust/a2-evaluation-input-context.md), [A3](../../architecture/add/vp05-evaluation-trust/a3-relation-reference-measurement.md)
- 새 Shotgun 인증 Reference: **0**. Provider 호출 / 기존 실험 재채점: **0 / 0**

## 1. 실제 확보한 증거

기존 A3의 SNLI/FEVER 조사를 출발점으로 사용했다. 새 모델 비교·평가 실행 대신 외부 label의 검증 provenance와 현재 v6 입력 계약의 동등성을 조사했다. 이전 구현 기록의 “dataset을 다운로드하지 않았다”는 당시 상태를 보존하며, 이번에는 원본을 격리 artifact에 보존했다.

[e-SNLI 저자 저장소](https://github.com/OanaMariaCamburu/e-SNLI/tree/7b585a3f077fdea899780eb0473940522ae44a2e)의 exact commit `7b585a3f077fdea899780eb0473940522ae44a2e`에서 development CSV, README, LICENSE를 확보했다. CSV는 9,842행이며 Git blob `4ce63116003f2ca8ddbf12035cebb9d019a0cf46`과 일치했다. 원본 순서에서 native label별 첫 4행, 총 12행을 선택했다. 의미 난이도나 모델 결과에 따라 고르지 않았다. 이 12행은 네 caption group에서 온 영어 사례이며 대표성이나 새 blind holdout을 주장하지 않는다.

[Stanford 공식 SNLI 1.0](https://nlp.stanford.edu/projects/snli/) archive에서 development JSONL의 같은 pairID를 대조했다. **12/12의 claim 두 개와 native label이 문자 그대로 일치**했다. 각 사례의 원본 5개 annotator label, 전체 JSON record 및 원본 line digest를 보존했다. 해당 native label과 같은 vote는 5개인 사례 7건, 4개 2건, 3개 3건이다. 이는 외부 annotation 기록의 분포이고 Shotgun 모델 성적·객관 오류율이 아니다. 서로 다른 vote를 제거하거나 전원 합의로 고쳐 쓰지 않았다.

SNLI는 원래 작성자의 label에 추가 네 annotator 판단을 수집한 validation 절차와 약 30명의 제한된 worker qualification을 기술한다. 이 절차 기록과 case별 vote를 확보한 것은 이전의 자료명만 확인한 상태보다 강한 증거다. 공개 case record는 각 vote의 실명·case별 전문성·승인 receipt를 제공하지 않으며 Shotgun tuple이나 A2 input profile을 검증한 기록도 아니다. [SNLI 원 논문 §2.1–2.2](https://aclanthology.org/D15-1075.pdf).

## 2. 인간 설명과 독립 의미 검증을 구분

e-SNLI는 인간 설명을 제공하지만 annotator에게 premise, hypothesis **및 기존 label**을 보여줬다. Development/test에는 사례별 설명 3개가 있으나 이는 label을 가린 독립 재판정 세 번이 아니다. 저자의 표본 설명 품질 검사는 dataset 전체의 모든 설명에 대한 개별 인증도 아니다. 이번 packet에는 설명 세 개를 원문대로 남겼으며 그 설명을 Shotgun warrant approval로 바꾸지 않았다. [e-SNLI 원 논문 Figure 1 및 §3](https://proceedings.neurips.cc/paper/2018/file/4c7a167bb329bd92580a99ce422d6fa6-Paper.pdf).

원본 필드 이름 `gold_label`은 외부 dataset의 필드명이다. 보정 A1에 따른 Shotgun `EXTERNALLY_VERIFIED` 상태를 뜻하지 않는다. 익명 vote나 설명의 존재만으로 허구의 reviewer, 서명 또는 인증 receipt를 만들지 않는다.

## 3. 현재 v6와 자동 대응할 수 없는 이유

현재 정책은 `vp-deepseek-relation-v6-evidence-context`, confidence gate는 기존 0.9다. 실제 정책 bytes는 [manifest](./external-reference-readiness-manifest.json)에 고정했다. 정책·prompt·schema를 바꾸지 않았다.

| 외부 증거                 | 현재 Shotgun과의 간극                                                                                                            | 이번 판정                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| SNLI/e-SNLI entailment    | 함의만으로 사례→주장 SUPPORTS와 조건/예외→넓은 주장 QUALIFIES의 역할·방향을 구별할 수 없음                                       | native label 보존; tuple mapping 미실행 |
| SNLI/e-SNLI contradiction | 같은 사진의 상황과 coreference를 전제하는 annotation 계약. v6는 전달된 claim/context의 동일 대상·속성 및 겹치는 조건을 요구      | 자동 CONTRADICTS 변환 금지              |
| SNLI/e-SNLI neutral       | NLI의 함의/모순 부재가 v6 RELATED, UNRESOLVED 또는 반대 방향 관계의 부재를 인증하지 않음                                         | NO_RELATION/UNRESOLVED로 변환 안 함     |
| native 설명/별표 표시     | 인간 설명의 내용·가정 검증과 Shotgun exact tuple의 독립 warrant 검증이 별도. 별표는 annotation이며 원문 EvidenceSpan 위치가 아님 | 원본 보존; Evidence ID·crop 생성 안 함  |
| Claim 두 문장             | 실제 application에서 선택한 SourceVersion/Evidence/context, 2,000 code-point crop 및 request capture가 없음                      | EC_RUNTIME_2000_V1 제품 입력 인증 불가  |

구체적인 간극은 pair `4705552913.jpg#2r1c`와 `3980085662.jpg#0r1c`에서 확인할 수 있다. 원본 native label은 contradiction이지만 두 문장은 각각 다른 사람 집단 또는 사람과 동물의 활동을 서술한다. A2와 v6만으로 동일 사건·대상을 가정하는 추가 권위는 없다. **이 관찰은 원본 NLI 정답을 오답으로 재채점한 것이 아니라 입력/계약을 바꾸면서 같은 정답을 재사용할 수 없다는 compatibility 분석**이다. SNLI 논문도 event/entity coreference 선택이 label에 영향을 준다고 설명한다.

Claim-only와 Evidence Context를 섞어 점수를 만들거나 외부 가정을 evaluator에만 보충하지 않는다. Native English caption 사례를 한국어 재무/계약/물리의 대표성 증거로 사용하지 않는다.

## 4. 재사용 결정 및 제외 대안

| 후보                           | 재사용 결정 / 확보 범위                                                                                                                     | 제외 범위와 재평가 조건                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SNLI 1.0                       | REFERENCE_ONLY. 공식 archive bytes와 case별 validation vote를 확보                                                                          | Shotgun Gold import DEFER. Exact target/input/warrant 대응의 독립 검증 필요                                                                 |
| e-SNLI exact commit            | REFERENCE_ONLY. 원본 라벨·설명·highlight와 provenance packet                                                                                | 코드/runtime/모델 채택 없음. 인간 설명을 자동 인증으로 사용할 수 없음                                                                       |
| Stanford contradiction corpora | REFERENCE_ONLY. [공식 annotation 설명](https://www-nlp.stanford.edu/projects/contradiction/)에 single/double annotation이 혼재한다고 명시됨 | 전 corpus를 일괄 독립 검증으로 분류하지 않음. Case별 절차·license·문맥 대응 확인 필요                                                       |
| ContractNLI                    | REFERENCE_ONLY / IMPORT_DEFER. [공식 문서](https://stanfordnlp.github.io/contract-nli/)의 문서/가설/evidence span 및 native task 확인       | 전체 계약→가설은 claim pair와 다름. NotMentioned의 빈 spans는 원문 전체 부재 판단이며 NO_RELATION 정답이 아님. Crop 후 원래 label 유지 금지 |

ContractNLI 공개 JSON의 `annotation_sets`는 여러 annotation을 담을 수 있는 구조지만 제공 데이터는 문서별 한 annotation이라고 공식 페이지가 설명한다. 배열 필드의 존재를 복수 독립 검토 횟수로 세지 않는다. Evidence를 가진 외부 reference라는 점은 유용하나 input-equivalence와 검증 책임을 자동 충족하지 않는다. SICK/FEVER의 기존 미채택 결정을 이번 조사가 바꾸지 않는다.

SNLI의 공식 dataset license는 CC BY-SA 4.0이다. e-SNLI 저장소의 MIT **software notice**도 별도로 보존했다. MIT 표시만 보고 상속된 SNLI 문장까지 MIT-only라고 선언하지 않는다. ContractNLI는 공식적으로 CC BY 4.0을 명시한다. 이번에는 원본을 외부 보존 위치에 두고 Git에는 제한·locator·digest만 기록했다. Production dependency/lockfile, OSS Role Matrix의 runtime 채택 상태는 변경하지 않았다. Dataset 배포·변환을 채택하려면 license 범위를 먼저 확인한다.

제외한 접근은 다수결/설명 존재만으로 Gold 생성, agent의 mapping 판단을 인간 검증으로 인증, entity 동일성 전제 추가, 새로운 reviewer DB/서비스 구축, prompt/schema 변경, 대량 live 평가다. 기존 CSV parser·Git blob/체크섬과 Shotgun A3 경계를 재사용한 오프라인 증거 준비이며 신규 제품 기능은 없다.

## 5. 오프라인 검증과 보존

- 원본 CSV/README/LICENSE 세 Git blob 일치, SNLI captured archive SHA-256 확인.
- 12/12 native text/label exact join, 원본 5 votes 및 설명/annotation 전체 보존.
- Claim 수정, native label 수정, 설명 수리, 임의 Shotgun tuple mapping, Gold 승격, 허구 runtime capture, vote 덮어쓰기 **7개 negative check 모두 거부**.
- 최초 label mutation 검사가 원래와 동일한 neutral을 넣어 실제 변조를 하지 못한 fixture 결함은 보정했다. Validator를 완화하지 않았고 이후 실제 다른 label로 바꾼 검사는 거부됐다. 최초 6검사 proof는 중간 기록이고 최종 결과는 7검사다.
- `prospective-review-input.json`에는 native label/설명을 제외한 원문 pair만 준비했다. 실제 reviewer review 0건이며, 개발자가 공개 label을 본 사실을 기록했다. 사용자 검토·reviewer 지정 의무는 없다.
- 최종 packet SHA-256: `b696509d1bbff2e86f14f743ea4f72aede85165a77d7ef1db6bbc5b28385c16a`.
- 외부 packet은 기존 A3 `RelationReference`가 아니다. 가짜 SourceVersion/Evidence ID, request capture, 허용 tuple 또는 승인 증빙을 생성해 evaluator에 넣지 않았다.
- 운영 DB/authority/Vault/configuration/환경 변수, 앱/worker, 실제 credential은 변경하지 않았다. 동결 72/432/B12, B 잔여24, Gold-B-7을 읽거나 재실행하지 않았다. 보존 파일은 hash-only 검사한다.
- `scripts/docs-validation.ts all`: 링크 746건, ADR 1–173, Canonical/evidence/generated registry, migration drift 및 completion/projection 검증 PASS. 변경 문서 4개의 Prettier check와 `git diff --check` PASS.
- 보존 검사: 보호 파일 79개 bytes, 다른 worktree 13개의 HEAD/status, configuration bytes 및 stash 동일. 보호 운영 컨테이너 두 개는 기존 ID/mount로 `exited`. 모든 host의 quiescence 또는 정상 운영 설치 검증을 주장하지 않는다.
- 외부 Reference 작업 범위의 diff는 문서와 외부 증거 manifest뿐이다. 함께 게시하는 owner 검증은 별도 fixture 두 개와 실제 격리 실행을 포함하며 [해당 기록](./canonical-owner-fake-proof.md)에 구분한다. 생산 코드/migration 변경이 없어 기존 main exact-tree CI38525754140을 코드 회귀 증거로 재사용했고, 외부 Reference 작업에서 unit/database/브라우저 시험을 반복 실행하지 않았다. 새 local 문서의 검사와 이전 main CI를 구분한다.

원본·script·결과·논문의 exact locator/size/digest는 [증거 manifest](./external-reference-readiness-manifest.json)에 기록한다. 외부 binary/라이선스 자료 보존과 Git 보고서의 Canonical 게시 상태는 별개다. Local 구현 문서는 merge 전 Canonical이 아니다.

## 6. 남은 병목 및 다음 경계

**Native NLI 인간 validation 증거는 12건 확보했지만 현재 Shotgun 제품용 인증 Reference는 여전히 0건이고 certification precision/recall/F1/Frontier recall은 N/A다.** 이 부족은 제품 사용에 Reference 승인 클릭을 추가할 이유가 아니다.

다음 의미 검증에 필요한 최소 조건은: 현재 v6 정책과 동일한 exact supplied input; 종류/방향/근거/가정/반대 해석/문맥 충분성에 대한 적격 외부 독립 검증 기록; case별 revision/digest 대응; 실제 app input capture; 대표 질문 obligation과 권한/Version 연결이다. 외부 reference의 native 검증 범위가 다른 field를 채운 것처럼 보고하지 않는다. 별도 외부 연락/유료 reviewer 고용은 이번 증거 확보에서 수행하지 않았다.

이 자료는 향후 적격 reviewer에게 제공할 후보 packet으로 사용할 수 있으나 **인증 Gold 또는 Canonical 평가 권위로 채택하지 않는다**. 공개 native NLI만 실행하는 다른 모델/새 prompt 실험으로 우회하지 않는다. 필요한 외부 의미 검증이 확보될 때까지 해당 Gate는 열려 있고, 독립적인 제품 실행/설치 안전 검증은 전체 실행 지시의 허용 범위에서 진행할 수 있다.
