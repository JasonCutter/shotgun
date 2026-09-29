# VP DeepSeek 의미 관계 실측 — 2026-09-29

## 대상과 재현

- 기준 Product: `main@cca36a87b2fbe77a97453ff31ac558ba871d1828`, 정책 `vp-deepseek-relation-v2`.
- `tests/integration/vp-deepseek-live.integration.test.ts`의 고정 합성 문장 14쌍을 실제 Vault 자격 증명과 DeepSeek 제공자로 평가했다. 테스트는 DB의 설정을 읽지만 Source·VP 원장에는 쓰지 않는다.
- 실행: `VP_LIVE_DEEPSEEK=1`과 해당 DB의 `DATABASE_URL`, `SHOTGUN_CREDENTIAL_MASTER_KEY`를 환경에 넣고 `node node_modules/vitest/vitest.mjs run tests/integration/vp-deepseek-live.integration.test.ts --reporter=verbose`를 실행한다. 비밀값은 출력하지 않는다.
- 각 문장의 선택지·토큰·지연과 함께 전체 성공 건수, 입력/출력 토큰 합계, nearest-rank p50/p95 지연을 JSON으로 출력하도록 테스트를 보완했다.

## 실측 결과

| 반복                                 | 허용된 안전 분류 | 입력 토큰 | 출력 토큰 | p50 지연 | p95 지연 |
| ------------------------------------ | ---------------: | --------: | --------: | -------: | -------: |
| 기존 테스트 코드, MAIN               |            14/14 |     5,925 |       798 |   797 ms | 1,060 ms |
| 합계 출력 보완 후, 같은 Product 설정 |            14/14 |     5,925 |       830 |   838 ms | 1,079 ms |

대상은 동의·모순·조건·연도/대상/측정 차이·단위 변환·한영 관계·원문 속 지시문을 포함한다. 모델의 자체 확률은 관측 정확도나 Fact 신뢰도로 취급하지 않는다. `QUALIFIES`의 저장 의미가 미정인 경우와 낮은 신뢰도의 관계는 기존 VP 안전 계약대로 확정 사실로 승격하지 않는다.

## OSS Integration Decision과 한계

- DeepSeek는 이미 연결된 `DecisionProviderPort` 뒤의 일반 AI 제공자 경로를 재사용한다. 프로젝트 설정에서 고정한 모델과 기존 Vault 자격 증명만 사용하며 새로운 OSS SDK·DB 권위는 추가하지 않는다.
- [gbrain](https://github.com/garrytan/gbrain) (`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT)는 VP Job/Graph에 `REFERENCE_ONLY`다. 이 테스트의 판단 권위나 원장으로 도입하지 않는다. `open-source-role-matrix.md` 변경은 없다.
- Adapter 교체 경계는 `DecisionProviderPort`; 실패·비정상 출력은 관계 기록 없이 보수적으로 처리한다. 테스트 보완은 생산 코드·Schema·데이터를 바꾸지 않으므로 롤백은 테스트 변경을 되돌리는 것이다.
- 14개 합성 사례의 두 차례 통과는 대표 Golden Corpus, 오류율 상한, 확률 calibration, 실제 청구 비용, 다량 자료의 호출 수·총 지연, Jev 대비 benchmark를 입증하지 않는다. 이 항목들은 VP-3 완료 Gate에 남는다. 제공자 가격을 확인하지 않았으므로 토큰 수를 통화 비용으로 환산하지 않는다.
