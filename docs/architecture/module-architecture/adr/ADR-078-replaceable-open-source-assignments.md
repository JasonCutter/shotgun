# ADR-078 — Replaceable Open-source Assignments

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 문서: `../open-source-role-matrix.md`

## 맥락

Shotgun은 gbrain, 두 llmwiki 프로젝트, Inkeep OpenKnowledge와 여러 범용 오픈소스의 우수한 부분을 활용하려 한다. 특정 프로젝트를 시스템 전체의 코어로 고정하면 모듈 독립성과 다른 프로젝트 재사용성이 낮아지고, 라이선스·유지보수·보안·API 변화가 전체 시스템에 전파된다.

## 결정

오픈소스는 시스템 전체가 아니라 **모듈별 Port 뒤의 역할**로 배치한다.

상태는 `REFERENCE`, `EXTRACT`, `ADAPTER_CANDIDATE`, `FOUNDATION_CANDIDATE`, `ADOPTED`, `DEFERRED`, `REJECTED`로 관리한다.

`garrytan/gbrain`은 Runtime, Canonical Knowledge, Search·Graph·Timeline과 Discovery의 최우선 참고·추출 후보로 유지하지만 Shotgun 전체의 단일 강결합 코어로 사용하지 않는다.

개별 라이브러리는 license, security, maintenance, benchmark와 migration·fallback Gate를 통과해야 `ADOPTED`로 승격한다.

## 제외 대안

- gbrain 전체 Runtime을 Shotgun Kernel로 고정
- 각 레퍼런스의 전체 애플리케이션을 병렬 실행
- 라이브러리의 내부 타입과 DB Schema를 Shotgun 공통 계약으로 사용
- 개발 편의를 이유로 교체 불가능한 공급자 SDK 직접 호출

## 영향

- 일부 기존 코드는 Adapter 또는 독립 package로 추출해야 한다.
- 초기 구현량은 늘지만 공급자와 제품 교체 범위가 한 모듈로 제한된다.
- 역할 변경은 조용히 덮어쓰지 않고 ADR과 Open-source Role Matrix에 기록한다.
- 기존 4-레퍼런스 통합 전략은 기술 가치 평가로 유지되며 구현 결합 방식만 모듈 중심으로 조정된다.
