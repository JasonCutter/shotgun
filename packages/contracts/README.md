# Shotgun Contracts v1

Stage 1에서 고정한 공개 계약이다.

- Message Envelope: `1.0.0`
- Asset Reference: `1.0.0`
- PingCommand: `1.0.0`
- PongEvent: `1.0.0`
- GetPongResult Query: `1.0.0`

계약의 호환 필드 추가는 같은 Major Version에서 허용한다. 필드 삭제, 의미 변경,
필수 필드 추가처럼 기존 Consumer가 처리할 수 없는 변경은 새 Major Version으로 만든다.

TypeScript Domain 코드는 `packages/contracts/src`의 타입에만 의존하며 Transport 구현을
알지 않는다. JSON Schema 원본은 `packages/contracts/schemas`에 둔다.
