# Security Rules

- scope: dependency,data,api
- priority: 95
- strength: MUST

## 1. Dependency

- 변경 전 npm audit 확인.
- --force 사용 금지(사전 설명 필수).
- deprecated 패키지 도입 금지.

## 2. Type & Validation

- any 사용 최소화.
- 사용자 입력은 검증 후 처리.
- 서버/클라이언트 경계 명확히 구분.

## 3. Sensitive Data

- 비밀키/토큰 클라이언트 노출 금지.
- 권한 로직은 서버(Route Handler/Server Action)에서 처리.
