# 어드민 플랫폼 연동 — 워크덱 홈페이지 GA4 (연결·향상된 측정 확인·주간 퍼널 리포트)

- 작성: 2026-11-21, 브랜치 `feat/admin-platform-ga4`(origin/develop 기준)
- 선행: GA4 퍼널 1단계(#1554·#1556, 측정 ID env 미등록), 고객용 「Google로 연결」(#1564·#1566)

## 1. 목표·배경

워크덱 홈페이지 GA4(`G-5F8G9Y4VHW`)는 **운영사 자산**이다. 고객 공간(Kaleos) 연결 정보로 두면 그 공간 ADMIN·공간 MCP 토큰(Hermes)이 운영사 데이터에 접근하고, 변경이 운영사 감사 로그에 남지 않는다(에디 지시 11-21: 운영사 토큰은 어드민에서 관리, 관리자·사용자 인증 분리).
→ admin.workdeck.work(OPERATOR + aal2) 에 「플랫폼 연동」 화면을 만들고, 고객 공간과 분리된 저장소에 둔다.

완료 기준:

1. 어드민 「플랫폼 연동」에서 운영자가 Google OAuth 클라이언트·GA4 속성/웹 스트림을 저장하고 「Google로 연결」 → 「연결됨」.
2. 같은 화면에 **향상된 측정 상태**(스트림 enhancedMeasurementSettings)와 **최근 7일 퍼널 요약**이 보인다 → GA4 측정 활성화 게이트(향상된 측정 OFF)를 여기서 확인.
3. 매주 월요일 09:00(KST) 서버 cron 이 같은 요약을 운영 Slack 채널(`sendSystemNotification`, 운영 Space 채널)로 보낸다. 향상된 측정이 켜져 있으면 경고 줄 포함.

## 2. 인증 분리 (검토 결과)

|             | 고객(app)                     | 운영사(admin)                                                                                     |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| 권한        | Space 역할 OWNER/ADMIN/MEMBER | `User.platformRole=OPERATOR`(CLI 부여만)                                                          |
| 비밀값 저장 | Space ADMIN + aal2            | **OPERATOR + aal2 항상**(`ADMIN_REQUIRE_MFA=false` 비상 해제여도 이 화면의 저장·연결은 aal2 요구) |
| 감사        | 없음                          | `writeAuditLog`(저장·연결·해제)                                                                   |
| 데이터 경계 | `SpaceCredential`(spaceId)    | 신규 `PlatformCredential`(공간 없음) — 공간 MCP 도구·공간 API 가 접근하는 경로 없음               |

- 플랫폼 자격증명은 MCP 에 노출하지 않는다(범위 밖). 조회는 어드민 화면·cron 서버 코드만.
- 고객용 Google 마케팅 연결(공간별)은 그대로 유지한다.

## 3. 변경

### 스키마 (마이그레이션 1건, `migrate dev`)

`PlatformCredential { id cuid, provider String @unique, encryptedPayload String, iv String, config Json?, lastVerifiedAt DateTime?, lastError String?, createdAt, updatedAt @updatedAt }` — SpaceCredential 과 같은 암호화 필드 형식, field-crypto 목적 `platform-credential` 을 추가하고 **`fieldWriteVersion` 에서 `space-credential`·`space-secret` 처럼 v1 강제**(운영 기본 v0·`ENCRYPTION_WRITE_VERSION=v0` 에서도 v1 — 목적별 키 파생). 테스트: v0 설정에서도 v1 암호문, 다른 목적(`space-credential`)으로 복호화 실패. 조건부 쓰기는 `config.credVersion`(최초 create=1이라 DbNull 분기 불필요).

### 서버

1. `src/lib/admin/platform-google.ts`
   - provider `google-analytics-platform`. secret `{ clientId, clientSecret, refreshToken? }`, config `{ propertyId(숫자), streamId(숫자), status(needs_auth|needs_check|connected), connectedAt, connectedBy, scopes, credVersion }`.
   - **변경과 감사 로그는 같은 Prisma transaction**: 조건부 updateMany/create + `writeAuditLog(..., tx)` 를 한 transaction 에서 — 감사 기록 실패 시 변경도 롤백(테스트). 외부 Google 호출(code 교환·속성 조회)은 transaction 밖, 최종 저장 때 credVersion 재검증.
   - `readPlatformGoogle()`, `writePlatformGoogleIf(row, secret, config)`(credVersion 조건부), `registerPlatformGoogle(input, operatorId)` — 저장 규칙은 고객용 `registerGoogle` 과 같은 원칙(같은 clientId 면 토큰 유지·다르면 제거, 속성/스트림 바뀌면 needs_check). 조건부 0행 → 409.
   - 범위: **`analytics.readonly` 만**(조회 전용 — 운영사 화면은 변경하지 않는다). 플랫폼 동의 URL 은 **`include_granted_scopes` 를 넣지 않는다**(`googleAuthorizeUrl` 에 옵션 추가, 고객용 기본값 유지). 반환 scope 에 추가 권한이 섞여도 필수(analytics.readonly) 포함만 확인하고 저장 scopes 는 반환 그대로 기록(테스트).
   - **OAuth 클라이언트 경계(수용·문서화)**: 같은 GCP 프로젝트의 클라이언트는 구글 계정의 「서드파티 액세스」에서 한 앱으로 묶여 철회도 함께 된다. 권장: `workdeck-app`(로그인용)과 별도로 **운영사 전용 OAuth 클라이언트**(예: `workdeck-admin-ga`)를 만들어 쓴다 — 리디렉션 URI 도 어드민 것만 등록. 같은 프로젝트라 계정 단위 철회는 여전히 공유됨을 롤백 절에 명시. 클라이언트별 철회는 `https://oauth2.googleapis.com/revoke?token=<refresh>`(어드민 「연결 해제」 범위 밖 — 필요 시 후속).
   - 재사용: `googleAuthorizeUrl`·`exchangeGoogleCode`·`GoogleOAuthError`(src/lib/agent/integrations/google-marketing.ts). access token 은 기존 `accessToken()` 이 GoogleCred 형식을 받으므로 플랫폼 secret 을 같은 모양으로 넘기거나 토큰 요청 함수를 export(동작 변경 없음).
   - `fetchEnhancedMeasurement()` → `GET analyticsadmin v1alpha properties/{p}/dataStreams/{s}/enhancedMeasurementSettings` → `{ streamEnabled, pageChangesEnabled(=pageChanges? 필드명 문서 확인), scrollsEnabled, outboundClicksEnabled, siteSearchEnabled, formInteractionsEnabled, videoEngagementEnabled, fileDownloadsEnabled }`. 함께 `GET v1beta properties/{p}/dataStreams/{s}` 로 measurementId 가 `G-5F8G9Y4VHW`(env `NEXT_PUBLIC_GA_ID` 와 같은지) 표시.
   - `fetchFunnelSummary(days=7)` → Data API `runReport`: eventName ∈ {page_view, cta_click, generate_lead, sign_up, trial_start, subscribe} 의 eventCount, + sessionSource/medium 별 sign_up·subscribe(상위 10). 오류는 상태+허용 코드만(비밀값·본문 미기록).
2. 라우트(모두 첫 줄 `requireOperator()`, 404 은닉 유지)
   - `GET /api/admin/platform/google` — 상태(비밀값 없이 hasRefreshToken), propertyId/streamId, 향상된 측정·퍼널 요약(연결됨일 때).
   - `PUT /api/admin/platform/google` — 저장(aal2 강제 + writeAuditLog `platform.google.save`, 메타에 비밀값 없음).
   - `POST /api/admin/platform/google/install` — Origin = 어드민 오리진, aal2, state(`createOAuthState('admin-google-analytics', {spaceId:'platform', userId, clientId})` — purpose 분리로 고객용 state 와 교차 불가) + nonce 쿠키(Path `/api/admin/platform/google`) → `{url}`. redirect_uri = `buildAdminUrl('/api/admin/platform/google/callback')`.
   - `GET /api/admin/platform/google/callback` — state·nonce·현재 사용자=state.userId·OPERATOR·aal2·clientId 동일 확인, code 교환, scope(analytics.readonly) 확인, 조건부 저장 needs_check → 속성/스트림 조회 성공 시 connected. writeAuditLog `platform.google.connect`. 예외는 try/catch 로 결과 화면. 결과 리다이렉트 `/admin/integrations?google=<…>`.
   - `oauth-state.ts`(공용)의 `spaceId` 필드를 쓰되 값 `'platform'` 고정 — 고객 콜백은 purpose 가 달라 검증 실패.
3. cron `app/api/cron/platform-funnel-report/route.ts` — 기존 cron 인증 방식(기존 cron 라우트와 동일) + **`withCronRun` 으로 실행 이력** → 연결됨이면 요약+향상된 측정 상태를 `sendSystemNotification`(운영 Space 채널)로. 연결 안 됐거나 실패면 한 줄 경고. **`sendSystemNotification` 이 false(채널 없음·전부 실패)면 실행 실패로 기록**(채널 여러 개면 1개 이상 성공=성공). `vercel.json` crons `0 0 * * 1`(월 09:00 KST).

### 화면

- `app/admin/integrations/page.tsx` + `src/components/admin/platform-google-card.tsx`, 어드민 NAV 에 「플랫폼 연동」.
- 카드: 클라이언트 ID·시크릿(보기 아이콘), GA4 속성 ID(숫자, `예: 412345678`, 측정 ID 아님 안내)·웹 스트림 ID(숫자, `예: 9876543210`, 「관리 → 데이터 스트림 → 스트림 세부정보」), 저장, 「Google로 연결」/「다시 연결」, 등록할 리디렉션 URI 표시(복사), 상태 줄.
- 연결됨이면: 측정 ID, 향상된 측정 항목별 켜짐/꺼짐(켜짐은 경고 색 + "GA4 퍼널 운영 게이트: 모두 꺼져야 측정 ID 등록 가능"), 최근 7일 퍼널 표.

## 4. 테스트

- 스키마/스토어: 최초 create(credVersion 1), 조건부 0행 409, clientId 변경 시 토큰 제거, 속성/스트림 변경 needs_check.
- 라우트: 비운영자 404(모든 라우트), aal2 없음 403(ADMIN_REQUIRE_MFA=false 여도 PUT·install·callback 은 403), Origin 불일치 403, 감사 로그 기록(비밀값 미포함), GET 비밀값 미노출.
- callback: state 위조·purpose 교차(고객용 state 거부)·다른 사용자·nonce 없음/재사용·거부·scope 부족·clientId 변경·정상 → needs_check→connected, 예외 시 쿠키 삭제.
- 데이터: enhancedMeasurementSettings·runReport 응답 파싱, 오류 시 비밀값·본문 미노출.
- cron: 인증 없으면 401, 미연결 경고, 연결됨 요약 발송, 발송 false → withCronRun 실패 기록, 채널 없음.
- 암호화: platform-credential v1 강제·목적 교차 복호화 실패.
- 감사 transaction: writeAuditLog 실패 시 자격증명 변경 롤백.
- 호스트·쿠키: proxy 에 admin 호스트 헤더로 `/api/admin/platform/google/callback` 이 통과하고 app 호스트에선 404(기존 proxy 테스트 패턴), install 응답 nonce 쿠키 속성(httpOnly·Secure·SameSite=Lax·Path `/api/admin/platform/google`), callback 리다이렉트가 `buildAdminUrl` 로 admin 오리진.
- 카드: 보기 토글, placeholder, G- 입력 안내, 연결 버튼.

## 5. 검증

tsc·eslint·관련 jest·`npm run build`, migrate dev 로 dev DB 적용. 어드민 호스트 분기는 preview 검증 불가(메모리: admin 은 prod 확인이 유일) → 배포 전에는 host 헤더 proxy 테스트·쿠키 속성 테스트로 대신하고, 실제 구글 왕복은 운영 배포 후 에디와 연결(실패해도 신규 화면만 영향 — 수용). GCP `workdeck-app` 클라이언트에 `https://admin.workdeck.work/api/admin/platform/google/callback` 등록 필요.

## 6. 롤백

revert + 마이그레이션은 신규 테이블 추가뿐이라 남겨도 무해(읽는 코드 없음). 토큰 무효화: `oauth2.googleapis.com/revoke` 로 플랫폼 refresh token 만 철회(권장). 구글 계정 「서드파티 액세스」에서 앱 삭제는 같은 GCP 프로젝트의 다른 클라이언트 승인까지 끊으므로 최후 수단. cron 은 revert 로 함께 제거.

## 7. 범위 밖

플랫폼 자격증명 MCP 노출, GA4 변경(쓰기), Search Console 연동(SEO 2단계에서), Kaleos 공간에 저장된 고객용 연결 정리(지금 없음 — 저장 실패 상태였음).

## 8. Codex 검토 반영 (2026-11-21)

지적 5건 — 반영 5: ① platform-credential v1 강제 ② 변경+감사 로그 같은 transaction ③ include_granted_scopes 제외·운영사 전용 OAuth 클라이언트 권장·철회 범위 명시 ④ withCronRun·발송 실패 기록 ⑤ host 헤더 proxy·쿠키 속성 테스트(실 왕복은 운영 후, 수용).
