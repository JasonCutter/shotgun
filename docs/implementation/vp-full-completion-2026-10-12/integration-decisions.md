# VP 연속 구현 — 선택 통합과 Gate 결정

상태: **LOCAL_IMPLEMENTATION_IN_PROGRESS / FINAL_ACCEPTANCE_NOT_COMPLETE**.
기준 `main@aba6ff27f9620ee1a3f408f8df81e8aad21cc584`. Source 지시 SHA-256
`17dbb19001ff1b5ea4622dcb67bd072325331ca84841f7f11a45e0c748897546`.
사용자 원문은 [execution-directive](./execution-directive.md)에 byte 그대로 보존한다.

## 선택 통합

| 범위         | 재사용/결정                                                                                          | 수정·영향                                                                                                                                                             | 되돌리기                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A3           | 기존 quality-evaluation ratio/digest AUGMENT; 오프라인 test artifact                                 | v6/v11 taxonomy, tuple/warrant, raw/adoption, zero N/A, supplied-provenance structural eligibility. 새 Gold 0                                                         | offline package/caller 제거; 운영 권위 영향 없음                               |
| Ask recovery | 기존 AnswerRun fail/queue/retry와 PostgreSQL transaction AUGMENT                                     | known snapshot stale만 failed attempt/event와 같은 transaction에서 QUEUED. 최대3, UNKNOWN은 제외                                                                      | 이전 코드; 이미 저장된 이력은 보존                                             |
| URL refresh  | SecureUrlAcquisition·sealed staging·product submit·현재 owner/standing resolver AUGMENT              | 기존 Sources Write 도메인 안의 coordinator, adapter, migration131. 정상 gateway accept/complete, version CAS, origin session audit FK, no paid repeat after ambiguity | worker 비활성 후 이전 코드; additive journal 유지                              |
| HTML URL     | 기존 Stage8 Python HTML 변환·Lucas 패턴 AUGMENT                                                      | HTML MIME만 추가. SSRF/DNS/redirect/size 정책 유지, 원본 bytes 불변, UTF-8 validation, script 실행 없음                                                               | URL MIME 허용만 되돌림; 원본/버전 보존                                         |
| Frontier     | 보존 로컬 snapshot/config/membership 패턴 선택 재사용. 완전한 relation-jobs/migration129 복사 REJECT | 새로운 bounded-postings v2; ACL 배열 순서 보존, max pool128/topK20, transactional header/member/job. normal worker는 명시 FRONTIER, 기존 replay/fake LEGACY_TEST      | worker mode와 app 연결을 이전 코드로 복귀. journal 및 기존 job 보존            |
| Backup       | 기존 pg_dump/pg_restore·backup owner AUGMENT                                                         | 새 `vp-execution-v2` profile은 VP/Sources/Ask/config/global claims/journals 포함. 과거 profile 부재는 legacy-v1로 읽고 한계를 표시                                    | legacy 백업 reader 호환 유지; 새 profile 백업의 검증 범위를 조용히 낮추지 않음 |

Frontier는 지식이나 예산 권위가 아닌 재생 가능한 discovery journal이다.
정확 text equivalence는 기존 Ledger의 deterministic receipt를 재사용한다.
새 relation/decision/history를 Frontier store가 직접 쓰지 않는다. 신규 선택
revision의 semantic critical/overall recall은 검증된 외부 모집단이 없으므로
**UNVERIFIED/N/A**다. 기능상의 bounded membership PASS를 품질 인증으로
해석하지 않는다. `relationQueueSettled`는 materialized queue 관측이고
`relationQueueComplete`는 현재 snapshot/revision/config의 complete membership와
terminal 상태를 요구한다. UNKNOWN/FAILED는 complete가 아니다.

Migration131/132는 기존129/130을 수정하지 않는다. T3의 기존 privileged
routine·project write fence를 재사용해 journal purge/status와 active ambiguous
work 차단을 포함한다. 운영 migration은 실행하지 않았고 worker-OFF 운영
상태를 유지한다. 새 코드 배포 전 schema 적용/복구·정책·전역 권위와 release
승인이 필요하다.

## OSS 검토와 경계

기존 registry/검증 결과를 출발점으로 사용했다. 새 npm/Python/provider/runtime
의존성은 설치하지 않았다.

- [gbrain](https://github.com/garrytan/gbrain),
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT:
  REFERENCE_ONLY job/lease/replay patterns. 전체 DB/runtime와 Ledger 우회는 제외.
- [lucas llmwiki](https://github.com/lucasastorian/llmwiki),
  `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0:
  기존 EXTRACT locator와 AUGMENT HTML/cleanup 패턴 유지. SQLite/VaultFS/MCP
  runtime은 제외. 이미 pinned Python requirements를 재사용한다.
- PostgreSQL/pgvector: 기존 ADOPT, PostgreSQL16 및 image
  `sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`.
  pg_dump/restore 자체를 다시 구현하지 않는다.
- PM2 `cd6b1b4c592117212d7349d6932288613f336c15`, AGPL-3.0:
  기존 REJECT. 기존 Node supervisor/IPC를 재사용한다.
- SNLI/FEVER: [A3 기록](./evaluation-a3-implementation.md)의
  REFERENCE_ONLY/IMPORT_DEFER. native taxonomy/context 차이 때문에 자동 Gold로
  가져오지 않는다. 사용자 개별 검토 책임을 만들지 않는다.

신규 직접 구현은 Shotgun 소유 reference/측정 의미와 현재 ACL/snapshot에
대한 local job membership만이다. 범용 OSS runtime/schema를 채택하면 데이터
권위·기존 execution binding을 우회하므로 해당 방식을 제외했다. 새 Port는
기존 Product/AI/Command contract와 adapter 뒤에 있으며 교체 검증은 기존
동일 contract 및 신규 unit/PG test에서 수행한다. OSS Role Matrix의 기존
채택 범위는 변경하지 않고 이 선택 통합 record를 추가한다.

## 검증 중 발견된 보정

1. 독립 source-refresh Module의 다른 도메인 import를 Architecture Gate가
   거부했다. 기존 Sources Write 도메인 안으로 coordinator를 이동했다.
   cross-domain validator 예외를 추가하지 않았다. A3에는 기존 규칙에 따라
   contracts/quality-evaluation 두 package edge만 명시했다.
2. 전체 unit/contract 최초 실행 11 failure는 공유 node_modules의 workspace
   link가 운영 checkout을 참조해 Error class identity를 분리한 환경 문제였다.
   운영 link를 수정하지 않고 개발 worktree의 dependency overlay를 만들었다.
   해당 4개 파일 63 tests가 재검증 PASS했다.
3. 기존 P0 regression이 accepted historical trace JSON을 덮어썼다.
   현재 실행 raw trace를 artifact에 보존하고 원본 Git bytes를 복구했다.
   이후 regression 출력은 별도 env target 또는 temp directory다.
4. 신규 Frontier PG suite 3개 assertion은 PASS했으나 tracked test pool을
   두 번 닫는 teardown이 실패했다. fixture owner만 close하도록 수정했다.
5. fake app read-query test는 concurrent relation worker call까지 세어 최초
   실패했다. read-path answer calls와 unrelated background calls를 분리했다.
   actual authorization/query failure assertions는 유지했고 통합14개 PASS했다.

초기 실패 로그를 삭제하지 않고 현재 artifact directory에 보존한다.
fake/isolated 결과는 실제 DeepSeek 정확성·실청구·Windows reboot·운영
cutover·Canonical merge·최종 설치본 인증이 아니다.
