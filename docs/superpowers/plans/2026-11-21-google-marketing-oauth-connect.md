# 구글 마케팅 「Google로 연결」 (OAuth 승인으로 refresh token 받기)

- 작성: 2026-11-21, 브랜치 `feat/google-marketing-oauth-connect`(origin/develop 기준)
- 선행: GTM 선택 항목화 #1561·#1562(main+prod)

## 1. 목표

설정 > 외부 서비스 연결 > Google 마케팅 팝업에서 refresh token 을 손으로 붙여넣지 않고 「Google로 연결」 버튼 → 구글 동의 → 워크덱 복귀 「연결됨」 으로 연결한다.
첫 사용처: Kaleos 공간(워크덱 GA4 `G-5F8G9Y4VHW`, 기존 GCP OAuth 클라이언트 `workdeck-app`) — MCP 로 웹 스트림 향상된 측정 설정을 읽어 GA4 퍼널 운영 게이트를 검증한다.

완료 기준: 운영에서 팝업에 클라이언트 ID·보안 비밀·브랜드(GA4 속성 ID) 저장 → 「Google로 연결」 → Kaleos 구글 계정 동의 → 「연결됨」 → 서버가 각 브랜드 GA4 속성 조회 1회 성공. 이후 `google_marketing_ga4_admin_get` 동작.

## 2. 결정

- **OAuth 클라이언트는 공간별로 저장한다**(지금처럼 팝업에 클라이언트 ID·보안 비밀 입력). 카페24 연결(#1559)과 같은 모델이고, 새 env·Google 앱 검증 없이 각 공간이 자기 GCP 클라이언트를 쓴다. 고객용 공용 클라이언트(워크덱 앱 하나로 모든 공간 연결)는 analytics 민감 범위 검증이 필요해 범위 밖.
- **카페24와 달리 토큰 회전이 없다.** 구글 refresh token 은 갱신해도 바뀌지 않고 access token 은 매 호출 refresh token 으로 받는다(현 `accessToken()`), 저장하지 않는다. → 갱신 lease 불필요. 쓰는 경로는 「저장」·「콜백」·「health 승격」 셋.
- **쓰기는 카페24 와 같은 정수 버전 조건부 쓰기**(`config.credVersion`, `updateMany where config.credVersion = 읽은 값`). 무조건 upsert(`saveSpaceCredential`)는 google-marketing 에 쓰지 않는다. 행 없음 → create(credVersion 1), unique 충돌 → 409. 저장 0행 → 409(다시 시도 안내). 콜백 0행 → 다시 읽어 clientId 가 state 와 같으면 1회 재시도, 아니면 error. **콜백의 모든 쓰기 시도(재시도·connected 승격 포함)는 그 시점 config 로 필수 범위를 다시 계산**해 부여 scope 가 부족하면 토큰은 저장하되 status `needs_auth`, 결과 `scope_missing`(GTM 추가와 콜백 교차 대비). → 저장·콜백 교차 실행에도 새 토큰·새 브랜드 설정이 덮이지 않는다. 기존 행(credVersion 없음)은 0 으로 읽고, **읽은 버전이 0 이면 조건을 「키 없음」(`config->'credVersion' IS NULL`, `$executeRaw` 또는 Prisma JSON null 필터 — dev DB 통합 테스트로 실제 동작 확인)** 으로 건다. `equals: 0` 은 키 없는 행과 맞지 않는다.
- 승인 범위(scope): GA4 조회·제안 실행에 필요한 `analytics.readonly` + `analytics.edit`. 브랜드 중 GTM 이 설정된 게 있으면 `tagmanager.readonly` `tagmanager.edit.containers` `tagmanager.edit.containerversions` `tagmanager.publish` 추가. `access_type=offline`, `prompt=consent`(refresh token 매번 발급), `include_granted_scopes=true`.
- 리디렉션 URI: `buildAppUrl('/api/integrations/google/callback')` = 운영 `https://app.workdeck.work/api/integrations/google/callback`. 클라이언트에 사용자가 등록(웹 애플리케이션 유형).

## 3. 변경 파일

1. 신규 `src/lib/integrations/oauth-state.ts` — 카페24 `oauth-state.ts` 와 같은 방식(서명 state + 일회용 nonce 쿠키)을 **목적(purpose) 파라미터를 받는 공용 함수**로. 키 = `HMAC(SLACK_SIGNING_SECRET, '<purpose>-oauth-state:v1')`. 구글 purpose `google-marketing`. payload `{ spaceId, userId, clientId, nonceHash, exp }`. 카페24 코드는 건드리지 않는다(동작 중인 코드 리스크 회피, 공용화는 후속).
2. `app/api/spaces/[spaceId]/credentials/[provider]/route.ts` — google-marketing 스키마:
   - secret `refreshToken` 을 **선택**으로. 저장 시: 값이 오면 그대로(기존 수동 입력·AML 호환), 안 오면 **기존 행의 clientId 가 같을 때만 기존 refresh token 유지**, clientId 가 바뀌었거나 행이 없으면 refresh token 없이 저장(=승인 필요).
   - config 에 서버가 관리하는 `status`(`connected`|`needs_check`|`needs_auth`)·`connectedAt`·`scopes`·`credVersion` — 입력으로 받지 않고(zod 가 버림) 저장 시 서버가 계산:
     - refresh token 없음 → `needs_auth`.
     - 유지/입력된 refresh token + 저장된 `scopes` 가 있으면 새 config 의 필수 범위(`requiredGoogleScopes`)와 비교 → 부족(예: GA4 만 승인 후 GTM 브랜드 추가)하면 `needs_auth`(토큰은 남김, 카드가 「다시 연결」 안내).
     - `scopes` 가 없는 기존 수동 토큰(AML) → 범위를 알 수 없으므로 기존 동작 유지(`connected` 취급, 강등 안 함).
     - 브랜드 GA4 속성이 바뀌면 `needs_check`(다음 health·재연결 때 속성 접근 확인).
   - 저장은 조건부 쓰기(2절).
   - **GET 응답**(관리자 전용) config allowlist 에 `status`·`connectedAt`·`scopes` 추가, 그리고 비밀값 대신 서버 계산 boolean `hasRefreshToken`(secret 복호화 결과로 계산, 값은 내보내지 않음). 기존 행(AML)은 hasRefreshToken=true·status 없음 → 카드가 「연결됨」.
3. `src/lib/agent/integrations/google-marketing.ts`
   - `GoogleSecret.refreshToken` 을 optional 로. `accessToken()` 이 refresh token 없으면 `GoogleApiError('Google 연결(승인)이 필요합니다', false)` — 호출부(도구·액션·health)는 기존 오류 경로 그대로.
   - 신규 `googleAuthorizeUrl(clientId, scopes, state, redirectUri)`, `exchangeGoogleCode(clientId, clientSecret, code, redirectUri)` → `{ refreshToken, scopes }`(오류는 상태+허용 코드만, 본문·토큰 미기록 — 카페24 규칙 동일), `requiredGoogleScopes(config)`.
   - `verifyGoogleBrands(cred)` — 각 브랜드 `GET /v1beta/properties/<id>` (targetUrl 경유) 1회. 콜백 확인용.
4. 신규 `app/api/integrations/google/install/route.ts` — 카페24 install 과 동일 규칙: POST 전용·`Origin` = 앱 오리진·Space ADMIN·aal2(`fetchWithMfa`)·자격증명(클라이언트 ID·보안 비밀) 없으면 400·nonce 쿠키(Path `/api/integrations/google`, 10분)·응답 `{ url }`.
5. 신규 `app/api/integrations/google/callback/route.ts` — state 서명·만료 + nonce(즉시 삭제) + 현재 사용자 = state.userId + ADMIN + aal2. `error` → denied. 저장된 clientId = state.clientId 확인(도중 변경 시 저장 안 함). code 교환(redirect_uri 바이트 동일). refresh token 없으면(이미 동의한 앱이 재발급 안 함) error. 부여된 scope 가 필요 범위를 포함하는지 확인 → 아니면 `scope_missing`. 저장(조건부): 읽기 → clientId 재확인 → secret.refreshToken 교체 + config.status **`needs_check`**·scopes. 그 뒤 `verifyGoogleBrands` 성공 → 조건부 쓰기로 `connected`·connectedAt, 결과 `connected`. 실패 → 상태 `needs_check` 유지 + lastError 기록, 결과 `property_denied`(토큰은 유지 — 속성 권한만 고치면 health 가 다음 날 승격, 또는 「다시 연결」). 결과 리다이렉트 `/settings/integrations?open=google-marketing&google=<connected|denied|error|scope_missing|property_denied|mfa_required|forbidden|expired>&spaceId=…`.
6. `src/components/integrations/ad-credential-form.tsx`(google-marketing 정의) — 리프레시 토큰 입력칸 제거. 저장 후 「Google로 연결」/「다시 연결」 버튼(install POST → `{url}` 로 이동), 상태 줄(연결됨·승인 필요 + 연결일·권한), 콜백 결과값 안내 문구, 리디렉션 URI 안내(복사용 주소 표시). 기존 refresh token 이 있는 행(AML)은 「연결됨」 으로 보인다.
7. `load-status.ts` — google-marketing 타일 상태: refresh token 없음 → 「승인 필요」.
8. `credential-health.ts` google probe: refresh token 없는 행(`needs_auth`)은 점검 오류로 알리지 않고 건너뜀(승인 전 상태가 매일 Slack 알림이 되지 않게). 있으면 access token + **`verifyGoogleBrands`**(브랜드당 GET 1회) — 속성 접근 실패를 health 성공이 숨기지 않게 한다. 성공하고 status 가 `needs_check` 면 조건부 쓰기로 `connected` 승격.

## 4. 테스트(jest)

- oauth-state: purpose 분리(구글 state 를 다른 purpose 로 검증 실패), 만료·위조·nonce 불일치·재사용.
- install: MEMBER 403, aal1 차단, Origin 불일치 403, 자격증명 없음 400, 응답 url 의 scope·redirect_uri·access_type·prompt, GTM 있는 브랜드면 tagmanager scope 포함.
- callback: state 위조·다른 사용자·nonce 없음·거부·clientId 변경·scope 부족·refresh token 없음·속성 접근 실패·정상(저장 값·status·리다이렉트), 모든 응답에서 nonce 쿠키 삭제.
- route 저장: refreshToken 생략 + 같은 clientId → 기존 토큰 유지, clientId 변경 → 토큰 제거·needs_auth, 값 지정 → 그 값, 같은 clientId 로 clientSecret 만 변경 → 토큰 유지. GA4 만 승인(scopes 저장) 후 GTM 브랜드 추가 → needs_auth. scopes 없는 기존 행 + GTM 추가 → 강등 안 함. 속성 변경 → needs_check.
- 기존 행(credVersion 키 없음)의 첫 PUT·콜백 성공(dev DB 통합 테스트 1건 + 단위).
- 콜백 승인(GA4 범위만) 직후 GTM 브랜드 저장이 먼저 끝나면 → 콜백 재시도에서 scope_missing·needs_auth.
- 경합: 저장과 콜백이 같은 버전을 읽고 교차 → 늦은 쪽 0행(저장 409 / 콜백 재읽기 후 재시도 또는 error), 새 토큰·새 브랜드 둘 다 보존. 행 삭제 후 콜백 → error.
- GET: status·connectedAt·scopes·hasRefreshToken 포함, 비밀값 미포함. 기존 행(AML 형식) → hasRefreshToken true.
- health: needs_auth 건너뜀(알림 없음), 속성 접근 실패 → 오류, needs_check + 성공 → connected 승격.
- accessToken: refresh token 없으면 승인 필요 오류(fetch 미호출).
- 비밀값 미노출: 토큰 교환 실패 응답에 토큰·본문을 넣어도 오류 메시지·lastError 에 없음.
- 폼: 리프레시 토큰 칸 없음, 저장 payload 에 refreshToken 없음, 「Google로 연결」 클릭 → install 호출·이동, 결과값 문구.

## 5. 검증

- tsc·eslint·관련 jest·`npm run build`.
- 로컬: 카페24 때처럼 dev 서버에 일회용 ENCRYPTION_KEY_V1·SLACK_SIGNING_SECRET 주입, install → 응답 url 파라미터 확인, callback 은 모의 code 로 token 요청을 route 차단해 주소만 기록.
- 운영(에디와): GCP `workdeck-app` 클라이언트에 리디렉션 URI 추가·Analytics Admin API 사용 설정 → Kaleos 공간 팝업 저장 → 연결 → 「연결됨」 → MCP 로 enhancedMeasurementSettings 조회.
- 기존 AML 자격증명 회귀: 운영 MCP `google_marketing_ga4_admin_get`(AML) 1회.

## 6. 롤백

- revert: 버튼·라우트가 사라지고, 콜백으로 저장된 refresh token 은 기존 형식(secret.refreshToken)이라 이전 코드에서도 그대로 동작한다. refresh token 없이 저장된(승인 전) 행은 이전 코드의 스키마에서 토큰 요청 실패 → 해당 공간에서 연결 해제 후 revert.
- 구글 쪽 철회: 구글 계정 보안 → 서드파티 앱 액세스에서 앱 삭제(토큰 즉시 무효).

## 7. 위험

- OAuth 동의 화면이 「테스트」 상태면 refresh token 이 7일 뒤 만료 → 카드에 안내(게시 상태 「프로덕션」 권장). 만료되면 health 가 invalid_grant 로 알리고 「다시 연결」 로 복구.
- `prompt=consent` 라 매 연결마다 동의 화면 — 연결 빈도가 낮아 수용.
- 리디렉션 URI 미등록이면 구글이 `redirect_uri_mismatch` 화면을 띄움 → 팝업에 등록할 주소를 표시.

## 8. 범위 밖

GA4 속성 목록에서 고르기(accountSummaries), 공용 플랫폼 클라이언트, 카페24 state 공용화, 연결 해제 UI 변경.

## 9. Codex 검토 반영 (2026-11-21)

지적 4건 — 반영 4.

1. [high] 저장·콜백 읽기 후 쓰기 덮어쓰기 → 카페24 와 같은 credVersion 조건부 쓰기, 0행 처리 규칙, 경합 테스트.
2. [high] 브랜드 변경 후 scope 재검증 없음 → 저장 시 필수 범위 vs 저장된 scopes 비교로 needs_auth, scopes 없는 기존 토큰은 강등 안 함.
3. [medium] 속성 검증 실패인데 connected → 콜백은 needs_check 로 저장 후 검증 성공 시 승격, health 가 속성 접근까지 확인·승격.
4. [medium] GET 이 상태를 안 줌 → allowlist 에 status·connectedAt·scopes, 서버 계산 hasRefreshToken.

## 10. Codex 2차 반영

지적 2건 — 반영 2. ① credVersion 키 없는 기존 행 조건(IS NULL) + dev DB 통합 테스트 ② 콜백 각 쓰기 시도마다 현재 config 로 필수 범위 재계산.
