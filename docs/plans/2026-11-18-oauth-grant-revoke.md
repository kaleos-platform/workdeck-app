# 연결된 AI 앱 해제 (OAuth 동의 철회) (2026-11-18)

## 목표

구성원이 자기 계정으로 연결한 AI 앱(ChatGPT·Claude 등 워크덱 MCP OAuth 클라이언트)을 직접 보고 해제할 수 있게 한다. 해제하면 그 앱은 **즉시** 워크덱 MCP를 못 쓴다(사용자 결정 2026-11-18). 계기: 11-17 ChatGPT 연결 시험 후 서버측 토큰 폐기를 확인할 화면이 없었다.

## 현재 구조

- 동의(grant)는 Supabase Auth OAuth 2.1 서버가 사용자별로 저장. supabase-js 2.97 `auth.oauth.listGrants()` / `revokeGrant({ clientId })`(사용자 세션 JWT로 호출).
- 철회 시 그 클라이언트의 세션·refresh token 즉시 삭제(Supabase 문서). 하지만 MCP `verifyToken`(`src/lib/mcp/auth.ts`)은 `getClaims`로 서명만 로컬 검증 → 이미 발급된 access token은 `exp`(기본 1시간)까지 통과.

## 변경

1. `src/components/settings/oauth-grants-card.tsx`(신규, client) — `MfaCard` 패턴. `listGrants()` 목록(앱 이름·허용 날짜), 「연결 해제」 → 확인 다이얼로그 → `revokeGrant` → 목록 갱신. 비어 있으면 「연결된 AI 앱이 없습니다」. 실패 시 오류 문구.
2. `app/settings/account/page.tsx` — `MfaCard` 아래에 카드 추가. 계정 단위라 역할 제한 없음.
3. `src/lib/mcp/auth.ts` — JWT 경로에서 기존 검사(sub·client*id·aud·iss)를 모두 통과한 뒤, `session_id` 클레임을 필수로 하고 DB `auth.sessions`에 `id=session_id AND user_id=sub AND oauth_client_id=client_id AND (not_after IS NULL OR not_after > now())` 행이 있는지 `$queryRaw`로 확인. 없으면 401. 에이전트 토큰(`wdk_agt*`) 경로는 그대로(DB `revokedAt` 이미 확인).
   - Supabase `/user`(getUser)는 OAuth 토큰 허용이 임시 호환이라 쓰지 않는다(Codex 지적). 외부 HTTP 호출 없이 이미 쓰는 DB 1쿼리.
4. 테스트: `src/lib/mcp/__tests__/auth.test.ts` — session_id 없음·세션 행 없음 → 401, 행 있음 → 기존 동작, 비대상 JWT(client_id 없음 등)는 세션 조회를 하지 않음. 카드는 목록·해제 호출 단위 테스트 1개.

## 비용·리스크

- MCP 요청마다 PK 조회 1회(같은 DB, `resolveUserPrincipal`도 이미 DB 조회). 캐시 없음(즉시 차단 요구).
- `auth` 스키마 내부 테이블 의존: dev DB에 `auth.sessions.oauth_client_id` 존재 확인(2026-11-18). 운영 앱 DB 역할이 `auth.sessions`를 읽지 못하면 OAuth MCP 전체 401 → 배포 직후 qa2 MCP 호출로 확인, 실패 시 즉시 revert.
- DB 오류는 지금처럼 401(기존 `resolveUserPrincipal` DB 오류와 같은 처리). 503 구분은 withMcpAuth 구조상 범위 밖.
- 연동 계정(`SpaceAgent.oauthClientId`)에 묶인 클라이언트도 철회는 그 사용자 본인 세션만 끊는다.

## 검증

- jest(mcp auth·카드), tsc, eslint, build.
- 운영 E2E(테스트 계정 qa2만): MCP 클라이언트를 qa2로 OAuth 연결 → 호출 성공 → 계정 설정에서 해제 → 같은 토큰 즉시 401 → 재연결 성공. 다른 사용자 연결에는 손대지 않는다. 즉시 401이 안 나오면 출시 범위에서 「즉시 차단」 문구를 빼고 사용자에게 보고.
- 11-17 ChatGPT 시험 grant 정리는 qa2 계정에서만.
- 아이폰 미러링으로 계정 설정 카드 배치 확인.

## 롤백

- release PR revert(스키마 없음). 단, 이미 해제한 연결은 복구되지 않음 — 사용자가 AI 앱에서 다시 연결해야 함. 세션 검사만 되돌리면 해제된 토큰이 만료(최대 1시간)까지 다시 통과.

## Codex 리뷰 (adversarial) — 지적 5건

1. [high] 즉시 차단 실측 없음 → 반영: 운영 qa2 E2E를 출시 조건으로.
2. [high] `/user`의 OAuth 토큰 허용은 임시 호환 → 반영: getUser 대신 DB `auth.sessions` 조회.
3. [high] Auth 장애가 401로 전파 → 반영(외부 호출 제거). DB 오류 401 처리는 기존과 동일, 503 구분은 보류(withMcpAuth 구조).
4. [medium] 비대상 토큰도 원격 호출 → 반영: 기존 클레임 검사 뒤에만 조회 + 테스트.
5. [medium] 롤백·운영 grant 영향 → 반영: 롤백 한계 명시, 운영 검증은 qa2만.
