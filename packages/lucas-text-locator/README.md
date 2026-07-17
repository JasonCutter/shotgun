# @shotgun/lucas-text-locator

`lucasastorian/llmwiki`의 검증된 Highlight 위치 찾기 동작에서 필요한 부분만 분리한
독립 패키지다. 공백이 달라진 인용문을 원문의 Unicode code-point 위치로 되돌리고,
반복 문구는 prefix·suffix 문맥으로 구분한다.

Shotgun DB, Kernel, AI Provider, 파일 감시기와 무관하며 Node.js만 있으면 사용할 수 있다.

```js
import { locateTextQuote } from '@shotgun/lucas-text-locator';

locateTextQuote('alpha\n  beta', { exact: 'alpha beta' });
// { start: 0, end: 12 }
```

Upstream 고정점과 수정 범위는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)에 있다.
