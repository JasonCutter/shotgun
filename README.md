# Shotgun

Shotgun은 한 점에 모인 지식이 산탄총의 탄환처럼 여러 방향으로 퍼져 나가며,
새로운 연결·행동·콘텐츠를 만들어 내는 개인 지식 시스템입니다.

## 현재 단계

- Stage 9까지 완료되어 Walking Skeleton MVP에 문서 형식과 Rich Knowledge 검토가 확장된 상태
- 최종 순서도 기준본: `docs/SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html`
- 상세 아키텍처 참고: `docs/shotgun_reference_architecture_strategy_ko.html`
- 모듈 아키텍처 기준선: `docs/architecture/module-architecture/README.md`
- 구현계획 기준선: `docs/implementation/README.md`
- 우선순위는 복잡한 전체 구조보다 작동하는 MVP 완성
- 원본 접수부터 Claim Canonical·인용 답변, 7개 Rich Knowledge 유형의 Atomic 검토와 Typed Edge 영향 분석까지 지원

## 개발 시작

개발 환경은 [Stage 0 문서](docs/engineering/stage-0-development.md)를 따르고,
Kernel 사용법은 [Stage 1 문서](docs/engineering/stage-1-kernel-runtime.md), 원본 접수와
Asset Resolver는 [Stage 2 문서](docs/engineering/stage-2-intake-original-asset.md), 검색과 인용 답변은
[Stage 7 문서](docs/engineering/stage-7-cited-search.md), Rich Knowledge와 Impact는
[Stage 9 문서](docs/engineering/stage-9-knowledge-model.md)에서 확인한다.

## MVP 목표

1. 지식 원본을 등록한다.
2. 근거가 연결된 Fact와 Claim을 저장한다.
3. 관련 지식을 연결하고 탐색한다.
4. 검토된 지식에서 행동과 콘텐츠를 생성한다.

## 이름의 의미

**Shotgun**은 지식이 한 점에만 머무르지 않고, 산탄총의 탄환처럼 여러 방향으로
확산되어 새로운 지식 연결과 실제 활용으로 이어진다는 의미입니다.

## 공개 범위

이 프로젝트는 비공개 저장소로 운영합니다.
