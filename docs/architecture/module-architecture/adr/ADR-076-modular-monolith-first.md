# ADR-076 — Modular Monolith First

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 ADD: `../shotgun-module-architecture-add.md`

## 맥락

Shotgun은 Phase 1~6의 긴 Knowledge Flow를 가지며 입력, 변환, AI, 승인, Canonical, Projection과 Action 기능을 다른 프로젝트에서도 재사용하려 한다.

처음부터 단일 애플리케이션으로 강하게 결합하면 재사용과 교체가 어렵다. 반대로 모든 기능을 즉시 마이크로서비스로 만들면 네트워크, 배포, 관찰, 데이터 일관성과 장애 복구 복잡도가 초기 제품에 과도하다.

## 결정

Shotgun을 명확한 Port와 데이터 소유권을 가진 독립 모듈로 설계하되 초기에는 하나의 Repository와 주 배포 단위에서 실행하는 **모듈러 모놀리스**로 구현한다.

AI 처리, 변환, Projection, Discovery와 Action처럼 무겁거나 독립 격리가 필요한 모듈만 측정 결과에 따라 Worker 또는 Service로 분리한다.

## 제외 대안

- 모든 기능을 하나의 계층 없는 애플리케이션으로 구현
- 처음부터 모든 모듈을 마이크로서비스로 배포
- 오픈소스 프로젝트별 Runtime을 나란히 실행하고 UI에서 조합

## 영향

- package와 Schema 수는 늘지만 테스트·교체·재사용 경계가 생긴다.
- 서비스 분리 전에도 Command·Event·Query 계약을 사용해야 한다.
- 직접 DB 접근을 막기 위한 Architecture Test와 권한 분리가 필요하다.
- 독립 서비스화는 목표가 아니라 성능·보안·재사용 요구가 확인될 때의 선택이다.
