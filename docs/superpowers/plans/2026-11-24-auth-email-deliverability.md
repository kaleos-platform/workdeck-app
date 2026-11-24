# 인증 메일 수신 실패 대응 — 링크 선방문 차단·재발송·안내

## 배경 (VOC 2026-11-24)

- 고객사 공간의 관리자 초대 2건이 10일간 4회 발송(`lastSendFailed=false`)됐지만 미수락.
- 고객사 메일은 기업용 이메일 보안 게이트웨이를 거친다. 격리·링크 사전 검사 가능성.
- 결정적 정황: 두 auth 사용자의 `last_sign_in_at`이 `invited_at`과 같은 분인데 앱 `User` 행이 없고 초대도 미수락.
  사람이 눌렀다면 `/invite/<token>`에서 수락했을 것 → **보안 장비가 메일 링크를 GET으로 먼저 열어 일회용 OTP를 소비**했다고 본다.
  이후 사용자가 누르면 OTP 만료 → 익명으로 초대 화면 → 비밀번호 모름 → 비밀번호 찾기 메일도 같은 방식으로 소비·격리 → 막힘.
- 발신 도메인 인증(SPF·DKIM·DMARC)은 정상. 원인은 받는 쪽.

## 목표

1. 메일 링크를 GET으로 열기만 해서는 토큰이 소비되지 않게 한다(사람이 버튼을 눌러야 확인).
2. 인증 메일 링크를 발신 도메인(`app.workdeck.work`)으로 통일한다(supabase.co 링크 제거).
3. 메일을 못 받은 사용자가 스스로 해결할 수 있게 한다: 스팸·격리함 안내, 인증 메일 다시 보내기, 이미 가입된 이메일 안내.

## 범위 밖

- Resend 쪽 설정(DKIM 2048비트 교체 등) — DNS 변경이라 별건.
- 앱 메일(Resend 직접 발송: 공간 초대·지원자 메일) 링크 — 이미 `app.workdeck.work`이고, 초대 수락은 이미 로그인 후 버튼(POST)이라 선방문 영향 없음.

## 단계

### Phase 1 — 화면 안내·재발송 (코드만, 운영 설정 변경 없음)

변경 파일:
- `src/components/auth/login-form.tsx`
  - 인증 대기 배너 문구에 「메일이 안 보이면 스팸함·회사 메일 격리함을 확인하고 noreply@workdeck.work 를 수신 허용해 주세요」 추가.
  - 배너와 「이메일 인증이 완료되지 않았습니다」 오류 아래에 「인증 메일 다시 보내기」 버튼. 로그인 폼의 이메일 값으로
    `supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })` 호출. 이메일 칸이 비었으면 입력 요청 문구.
    성공/실패 토스트, 60초 재시도 쿨다운(버튼 비활성). 429는 「잠시 뒤 다시 시도」.
  - `emailRedirectTo`는 signup-form과 같은 값이어야 하므로 공용 함수로 뺀다(`src/lib/auth-redirect.ts`에 `emailConfirmRedirect(origin, next)`).
- `src/components/auth/signup-form.tsx`
  - 이미 가입된 이메일 구분 메시지는 넣지 않는다(계정 존재 열거 방지, Codex 지적). 대신 인증 대기 배너가 공통으로
    「메일이 오지 않으면: 스팸·격리함 확인 / 이미 가입했다면 로그인·비밀번호 찾기 / 인증 메일 다시 보내기」를 보여 준다.
  - 가입 시 `options.data.signup_next`에 정리된 next 경로(`sanitizeRedirectPath`)를 싣는다 → Phase 2 템플릿이 `{{ .Data.signup_next }}`로 쓴다(중첩 URL 전달 없음).
  - 가입 이메일을 sessionStorage(`wd:pending-email`)에 두고 로그인 폼이 초기값으로 읽는다(URL에 이메일 남기지 않음).
- `src/components/auth/forgot-password-form.tsx` 성공 문구에 같은 스팸·격리함 안내 한 줄.
- `src/components/invite/invite-accept.tsx` 익명 화면 안내에 「메일 링크가 만료로 보이면 회사 보안 장비가 링크를 먼저 열었을 수 있다 → 비밀번호 찾기」 한 줄은 넣지 않는다(과설명). 대신 Phase 2로 근본 해결.
- 테스트: `src/components/auth/__tests__/`에 재발송 버튼(이메일 없음·성공·429)과 identities 빈 배열 케이스.

### Phase 2 — `/auth/confirm` 선방문 안전화 + 템플릿 링크 통일

변경 파일:
- `app/auth/confirm/route.ts` → GET은 토큰을 검증하지 않고 확인 화면으로 리다이렉트만:
  `/auth/confirm/continue?token_hash&type&next` (쿼리 그대로). POST 핸들러(form submit)가 `verifyOtp` 후 기존 분기 수행.
  - 기존 GET 링크(이미 발송된 초대 메일)도 그대로 동작해야 한다 → GET은 같은 쿼리로 확인 화면에 넘기기만 하면 호환.
- `app/auth/confirm/continue/page.tsx`(신규, 서버 컴포넌트) — 「계속하려면 버튼을 누르세요」 + `<form method="post" action="/auth/confirm">` 숨은 필드(token_hash·type·next). JS 없이 동작.
  - type별 제목: invite「작업 공간 초대 확인」, signup/email「이메일 인증」, recovery「비밀번호 재설정」, email_change「이메일 변경 확인」, magiclink「로그인」.
- POST 분기(기존 GET 로직 이전 + 추가):
  - `invite`: 기존대로 next(/invite/…)로. 실패 시 next가 /invite/면 그쪽으로.
  - `signup`/`email`: 기존 /auth/callback `type=email` 동작과 동일 — 세션 종료 후 `/login?verified=success`(next 있으면 redirectTo 유지, `/d/<id>`면 `/d/<id>/login`). 이 분기를 공용 함수로 빼서 callback과 공유.
  - `recovery`: `/reset-password`로(세션 유지).
  - `email_change`: 기존 동기화 로직 유지.
  - `magiclink`: next로.
  - 리다이렉트는 303(POST→GET).
  - **로그인 CSRF 방지**: POST는 `Origin` 헤더가 앱 origin과 같을 때만 처리(없거나 다르면 403). 외부 origin 제출 회귀 테스트.
  - **실패 시 막다른 길 제거**: verifyOtp 실패(만료·이미 사용) 화면에서 type별 다음 단계 — email은 「인증 메일 다시 보내기」(로그인 화면 재발송으로), recovery는 「비밀번호 찾기 다시」, invite는 기존대로 초대 화면.
- `src/lib/email/supabase-templates.ts` — `{{ .ConfirmationURL }}`을 모두 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<t>&next=…`로:
  - confirmation: `type=email&next={{ .Data.signup_next }}`(가입 때 user_metadata에 실은 경로, 서버에서 다시 `sanitizeRedirectPath`). `{{ .RedirectTo }}` 중첩 전달은 쓰지 않는다.
  - recovery: `type=recovery`. magic_link: `type=magiclink`. email_change: `type=email_change`(Secure email change 켜져 있으면 두 통 모두 `{{ .TokenHash }}`가 각 주소용으로 채워짐 — dev에서 실측).
  - 생성물 `docs/email/auth-templates/*.html` 재생성, README 표·주의 갱신.
- 테스트: `app/auth/confirm/__tests__/route.test.ts` — GET은 verifyOtp를 부르지 않고 continue로 302, POST 분기별(invite·email·recovery·email_change·실패) 결과, `redirect_to` 외부 origin 무시.

### Phase 2 운영 반영 (에디 승인 필요)

1. 코드 main 배포(Phase 2 코드는 기존 템플릿·기존 초대 메일 링크와 호환되므로 템플릿보다 먼저 나가도 안전).
2. dev Supabase(`tumk…`)에 새 템플릿 적용 → 가입·재설정·초대·이메일 변경 실수신, 링크 클릭 → 확인 화면 → 버튼 → 결과 확인.
   - 선방문 재현: 메일 링크를 `curl -sI`로 먼저 GET → 그 뒤 브라우저에서 버튼 눌러 성공해야 한다.
3. 운영 Supabase 템플릿 4종(confirmation·recovery·magic_link·email_change) 적용(Management API, 이전 본문 백업 저장).
4. 운영 실수신: 공용 테스트 계정으로 재설정 1회.

## 검증

- `npx tsc --noEmit`, `npm run lint`, 관련 jest.
- 로컬 dev에서 가입→재발송, 이미 가입된 이메일 가입, 선방문 curl 후 버튼 확인.
- 모바일(아이폰 미러링, Codex 위임)로 확인 화면 표시·버튼 동작 1회.

## 위험·롤백

- **방어 한계(Codex 지적)**: 확인 화면은 GET만 하는 링크 검사기를 막는다. 폼까지 자동 제출하는 장비는 막지 못한다(메일 속 6자리 코드도 같은 일회용 OTP라 대안이 안 됨). 그래서 실패 시 재발송 경로와 IT 예외 요청 안내를 함께 둔다.
- **템플릿 롤백 시 재노출**: 이전 템플릿(ConfirmationURL)으로 되돌리면 Supabase `/verify` GET에서 다시 소비될 수 있다. 롤백은 장애 시에만, 롤백 후 기존·신규 메일 각각 확인. 이미 발송된 옛 링크는 코드 배포만으로 보호되지 않는다 → 영향 사용자는 재발송.

- Phase 2 템플릿 적용 후 문제가 생기면 백업한 이전 템플릿으로 Management API PATCH(즉시 복구). 코드는 기존 링크와 호환이라 롤백 불필요.
- 확인 화면 한 단계가 늘어 클릭 1회 증가 — 선방문 소비를 막는 대가로 수용.
- POST 폼은 같은 origin 제출이라 CSRF 영향 없음(토큰 자체가 비밀값). 토큰이 HTML 숨은 필드에 남지만 이미 URL에 있던 값.
- PKCE `exchangeCodeForSession` 경로(/auth/callback)는 OAuth용으로 남긴다.

## Codex 검토 반영 (2026-11-24)

지적 5건 — 반영 5, 보류 0.
1. 자동 POST 스캐너 → 방어 범위를 GET 검사기로 명시, 실패 시 재발송 경로 추가(OTP 코드 입력은 같은 토큰이라 효과 없어 제외).
2. 로그인 CSRF → POST Origin 검증 + 테스트.
3. redirect_to 중첩 → `{{ .Data.signup_next }}`로 변경.
4. 템플릿 롤백 재노출 → 위험 항목에 명시.
5. 계정 존재 열거 → identities 분기 메시지 제거, 공통 안내로 대체.
검증 추가: dev에서 secure email change 두 통의 TokenHash 실측, verifyOtp 타입(`email`·`recovery`·`invite`·`email_change`·`magiclink`)을 설치된 SDK 타입과 dev 서버로 확인.
