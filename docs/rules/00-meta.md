# Meta Rule (Rule Router)

- scope: global
- priority: 110
- strength: MUST

## Rule Loading Policy (Token Optimized)

- 기본 로드: docs/rules/01-core.md
- 조건부 로드:
  - Next.js(App Router)/UI 구조/성능/라우팅/컴포넌트 관련이면: + docs/rules/02-architecture.md
  - 의존성 업데이트/취약점/권한/민감정보/API 보안/검증이면: + docs/rules/03-security.md

## If unsure

- 추가 규칙을 추측으로 적용하지 말고, 필요한 규칙 파일을 먼저 열어 확인하거나 질문한다.

## Response format

- 불필요한 서론 없이 본론부터.
- 구현 전 3–7개 불릿 계획 → 구현 → 간단 검증.
