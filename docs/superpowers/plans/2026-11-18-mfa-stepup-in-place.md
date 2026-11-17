# 2단계 인증 후 저장 누락 수정 — 제자리 단계 인증 + 같은 요청 재전송

## 문제

권한·자격증명·비밀값 저장 API 가 `403 MFA_REQUIRED` 를 주면 `redirectIfMfaRequired`(src/lib/auth/mfa-client.ts)가
`/auth/mfa?next=…` 로 **페이지를 이동**한다. 인증 후 돌아오면 화면 상태(체크한 권한, 입력한 키·비밀번호)가 사라지고
저장 요청은 한 번도 서버에 가지 않았다. 사용자는 저장된 줄 안다(2026-11-18 에밀리 hiring scope 사례).
같은 헬퍼를 쓰는 화면 11곳이 모두 같다.

## 목표

- 인증이 필요한 저장을 누르면 **현재 화면 위 다이얼로그**에서 TOTP 6자리를 받고, 성공하면 **같은 요청을 다시 보내** 저장을 끝낸다.
- 입력값을 잃지 않는다. 사용자가 다시 누를 필요가 없다.
- 인증 기기가 없는 계정(QR 등록 필요)은 지금처럼 `/auth/mfa` 로 이동(등록 화면이 필요). 이 경우만 기존 동작.
- 다이얼로그를 닫으면(취소) 저장하지 않고 「2단계 인증을 취소해 저장하지 않았습니다」를 보인다(페이지 이동 없음).

## 설계

1. `src/lib/auth/mfa-client.ts`
   - `fetchWithMfa(input, init)` 추가: `fetch` → 응답이 403 `MFA_REQUIRED` 가 아니면 그대로 반환.
     맞으면 `requestMfaStepUp()` 결과에 따라
     - `verified` → 같은 `input, init` 으로 1회 재요청해 그 응답 반환(재요청도 MFA_REQUIRED 면 그대로 반환 → 아래 fallback).
     - `cancelled` → `Response.json({ message: '2단계 인증을 취소해 저장하지 않았습니다', code: 'MFA_CANCELLED' }, { status: 403 })` 반환(호출부의 기존 오류 표시 경로로 흐름).
     - `enroll`(verified TOTP factor 없음) → 원래 응답 반환 → 호출부 `redirectIfMfaRequired` 가 기존처럼 이동.
   - `redirectIfMfaRequired` 는 그대로 둔다(fallback).
   - body 는 문자열/FormData 만 쓰므로 재전송 가능(스트림 body 는 쓰지 않음 — 호출부 확인 완료).
2. `src/components/auth/mfa-step-up-dialog.tsx` 신규
   - `requestMfaStepUp(): Promise<'verified'|'cancelled'|'enroll'>` — `listFactors` 로 verified TOTP 확인, 없으면 `enroll`.
     있으면 `createRoot` 로 shadcn Dialog 를 body 에 마운트, 코드 입력 → `challengeAndVerify` → 성공 시 `verified`.
     동시에 여러 요청이 와도 다이얼로그는 1개만(진행 중 Promise 공유).
   - 문구·타임아웃은 `MfaStepUp` 과 같은 규약(`withAuthTimeout`, 오류 「인증 코드가 올바르지 않습니다.」).
3. 호출부 11곳: 쓰기 요청의 `fetch(` → `fetchWithMfa(` 로 교체(뒤의 `redirectIfMfaRequired` 는 유지 — enroll fallback).
   대상: agent-tokens-card, space-secrets-card, coupang-api-card(2), members-card, credential-form(settings), ai-settings-form,
   sc/channels/credential-form, sc/channels/naver-credential-form, sc/settings/osmu-connections, sh/settings/naver-nbaesong-card,
   admin/recovery-key-settings(2).

## 보안 검토 포인트

- 서버 게이트(`requireAal2`)는 그대로 — 클라이언트 변경은 UX 만. 재전송은 같은 사용자 세션·같은 본문이라 권한 확대 없음.
- 재전송은 최대 1회(무한 루프 방지). 재요청 응답이 다시 MFA_REQUIRED 면 기존 이동 fallback.
- 다이얼로그는 코드만 받고 비밀값을 다루지 않는다. 기기 교체(mode=replace)·등록은 기존 `/auth/mfa` 페이지 전용으로 남긴다.
- 비멱등 요청(POST 토큰 발급 등)도 첫 요청은 서버가 403 으로 거절해 실행되지 않았으므로 재전송이 중복 실행을 만들지 않는다.

## 테스트

- `mfa-client.test.ts`: fetchWithMfa — 비MFA 응답 통과 / verified → 재요청 1회·두 번째 응답 반환 / cancelled → MFA_CANCELLED 403 / enroll → 원 응답 반환 / 재요청도 MFA_REQUIRED 면 루프 없음.
- `mfa-step-up-dialog` 단위: factor 없음 → enroll, 코드 성공 → verified, 닫기 → cancelled, 동시 호출 → 다이얼로그 1개.
- agent-tokens-card 테스트: 권한 저장 중 MFA_REQUIRED → (stepUp mock verified) → PATCH 2회, 다이얼로그 닫힘·목록 갱신.
- lint·tsc·build. 운영 확인: 설정 > 연동에서 aal1 세션으로 권한 저장 → 다이얼로그 → 저장 반영(사용자 OTP 필요).

## 롤백

클라이언트 전용 변경(스키마·API 무변경). 문제 시 릴리스 revert.

## Codex 적대적 리뷰 반영 (2026-11-18, 지적 4건 — 반영 4, 보류 0)

1. [high] 동시 요청 재실행 순서 — 인증 대기 중 여러 요청이 MFA_REQUIRED 를 받으면, 인증 후 재전송을 **MFA 를 받은 순서대로 직렬 실행**한다
   (모듈 단위 promise 체인). 다이얼로그는 1개. 승인 한도처럼 연속 클릭한 경우 마지막 클릭이 마지막에 반영된다. 테스트: 두 요청 역순 응답 지연에도 재전송 순서 유지.
2. [high] 인증 직후 재요청이 다시 MFA_REQUIRED — **페이지 이동하지 않는다.** `code: 'MFA_RETRY_FAILED'`(403, 「인증은 완료됐지만 저장하지 못했습니다. 다시 시도해 주세요」)로
   돌려 입력값을 유지한다(`redirectIfMfaRequired` 는 MFA_REQUIRED 만 이동). 재전송 전 `supabase.auth.getSession()` 으로 저장된 세션을 한 번 읽어 쿠키 반영을 보장.
   실제 쿠키 경로는 운영에서 aal1 세션으로 권한 저장 실검증(사용자 OTP)으로 확인한다.
3. [medium] 취소 안내가 호출부마다 다르게 표시 — 취소·재시도 실패 안내는 **`fetchWithMfa` 안에서 sonner 토스트로 직접** 띄운다(호출부 오류 처리 계약과 무관).
   호출부는 기존 오류 문구를 그대로 보여도 된다.
4. [medium] recovery-key GET 포함 여부 — **포함**한다(조회도 같은 게이트). 취소 시 토스트 + 기존 조회 오류 표시, 인증 시 재조회.
