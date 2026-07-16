# Shotgun Contracts v1

Stage 1~2에서 고정한 공개 계약이다.

- Message Envelope: `1.0.0`
- Asset Reference: `1.0.0`
- PingCommand: `1.0.0`
- PongEvent: `1.0.0`
- GetPongResult Query: `1.0.0`
- SubmitIntake Command: `1.0.0`
- IntakeAccepted Event: `1.0.0`
- OriginalAssetStored Event: `1.0.0`
- GetIntakeResult Query: `1.0.0`
- ResolveAsset Query: `1.0.0`

계약의 호환 필드 추가는 같은 Major Version에서 허용한다. 필드 삭제, 의미 변경,
필수 필드 추가처럼 기존 Consumer가 처리할 수 없는 변경은 새 Major Version으로 만든다.

TypeScript Domain 코드는 `packages/contracts/src`의 타입에만 의존하며 Transport 구현을
알지 않는다. JSON Schema 원본은 `packages/contracts/schemas`에 둔다.

`AssetReference.storageUri`는 실제 파일 경로가 아니라
`asset://{assetId}/versions/{sourceVersionId}` 형식의 Resolver 전용 URI다.
