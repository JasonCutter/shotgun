# ADR-077 — Common Contracts and Connector Runtime

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 ADD: `../shotgun-module-architecture-add.md`

## 맥락

모듈을 레고처럼 조립하려면 구현 언어와 배포 위치보다 안정적인 연결 계약이 먼저 필요하다. 하나의 만능 함수 또는 각 모듈의 임의 API를 사용하면 결합도가 다시 높아진다.

## 결정

Shotgun Kernel은 공통 Message Envelope와 다음 Port를 제공한다.

- Command
- Event
- Query
- Asset Reference

모든 메시지는 schema version, producer module, correlation·causation ID, project·actor, Security Context, Provenance, Job·Attempt와 생성 시각을 전달한다.

Transport는 In-memory, In-process, Queue, HTTP, gRPC, Webhook 또는 MCP로 교체할 수 있으며 Domain Module은 사용 중인 Transport를 알지 않는다.

모듈은 다른 모듈의 DB Schema와 공급자 SDK를 직접 사용하지 않는다.

## 제외 대안

- 공유 DB를 사실상의 통합 API로 사용
- 각 모듈이 임의 REST API를 정의
- 파일 전체를 메시지에 반복 첨부
- Event와 Command를 구분하지 않는 단일 Bus

## 영향

- Contract와 schema version 관리가 핵심 개발 작업이 된다.
- Module Manifest와 Compatibility Validator가 필요하다.
- 중복 전달, Retry, Timeout, stale version과 outcome unknown을 공통 오류 모델로 처리한다.
- 대형 파일은 Asset Reference로 전달한다.
