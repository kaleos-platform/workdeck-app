# 작업 공간 초대 — 가입자 초대 메일 · 초대 상태 목록 · 다시 보내기

- 작성: 2026-11-15, grill-me 11개 결정(에디 확정)
- 대상 브랜치: `feat/space-invite-email-status` (base `origin/develop`)

## 목표

1. 이미 가입한 이메일을 초대해도 초대 메일을 보낸다. 메일 링크(`/invite/{token}`)를 열고 **초대받은 이메일 계정으로 로그인한 상태에서 「수락」** 하면 완료(현행 `acceptInvitation` 검증 — 이메일 일치·이메일 인증 완료 — 그대로).
2. 소유자가 구성원 화면에서 초대 상태(대기·수락·만료·취소)를 확인한다.
3. 대기 초대를 다시 보낼 수 있다(새 링크, 만료 7일 재시작, 제한 있음).

## 확정 결정

| #   | 결정                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 가입자에게도 Resend 로 초대 메일. 별도 확인 코드 없음. 로그인 없는 자동 소속(C안) 금지                                                                                                                                                                                                |
| 2   | 초대·다시 보내기 직후 「링크 복사」는 보조 수단으로 유지(작게, "메일이 안 오면")                                                                                                                                                                                                      |
| 3   | 구성원 화면 「초대」 목록: 상태 배지 대기(amber)·수락(emerald)·만료(회색)·취소(회색). 대기 전부 + 최근 30일 내 수락·만료·취소. OWNER 만. 만료 7일(현행 `INVITE_TTL_DAYS=7` 유지)                                                                                                      |
| 4   | 다시 보내기 = 토큰 재발급(이전 링크 무효), `expiresAt` 7일 재시작, 같은 행 유지. 1분 쿨다운                                                                                                                                                                                           |
| 5   | 미가입 이메일은 현행 Supabase invite 메일(가입 흐름) 유지. 상태 목록·다시 보내기 규칙은 동일 적용                                                                                                                                                                                     |
| 6   | 가입자 메일: 제목 `[워크덱] {초대자}님이 「{작업 공간}」 작업 공간에 초대했습니다`, 공용 레이아웃 `renderEmail`(헤더 `{kind:'space', name}`), 발신 `"워크덱" <noreply@workdeck.work>`, 본문 작업 공간·역할·초대자·만료일·「초대 확인하기」·로그인 안내·무시 안내. 수락 알림 메일 없음 |
| 7   | 스키마: `SpaceInvitation.lastSentAt DateTime?`, `sendCount Int @default(1)`. 다시 보내기 총 5회(초대 1건당)                                                                                                                                                                           |
| 8   | 같은 이메일 재「초대」 시 대기 초대가 있으면 새 행 대신 그 행을 다시 보내기(4·7 규칙), 역할이 다르면 갱신, 안내 "이미 대기 중인 초대가 있어 다시 보냈습니다". 만료·취소 이력만 있으면 새 행                                                                                           |
| 9   | 메일 실패해도 초대 유지. `lastSendFailed Boolean @default(false)` 추가, 목록에 「메일 실패」. 쿨다운은 시도 시각(`lastSentAt`), 5회는 성공(`sendCount`)만. `RESEND_API_KEY` 없음 = 실패 처리                                                                                          |
| 10  | 초대 생성·취소 = OWNER + AAL2(현행). **다시 보내기 = OWNER 만(AAL2 면제)**. **목록 조회(GET) = OWNER 만(AAL2 해제)** — 현재 GET 도 `guard()` 로 AAL2 를 요구해 운영 콘솔 403 의 원인                                                                                                  |
| 11  | 운영 검증: qa2(「테스트」 OWNER, TOTP 비밀 키는 자격증명 파일) 초대 → kaleos 메일함(Ego 브라우저 위임)에서 메일 확인 → devops 수락 → 상태 「수락」 → devops 내보내기 정리                                                                                                             |

## 변경 파일

### 스키마

- `prisma/schema.prisma` — `SpaceInvitation` 에 `lastSentAt DateTime?`, `sendCount Int @default(1)`, `lastSendFailed Boolean @default(false)`.
- `prisma/migrations/<ts>_space_invitation_send_tracking/migration.sql` — `npx prisma migrate dev --name space_invitation_send_tracking`. 기존 행 `lastSentAt = createdAt` 백필 UPDATE 를 같은 마이그레이션에 포함. (`db push`·prod 직접 SQL 금지)

### 서버

- `src/lib/spaces/invitations.ts`
  - `createInvitation`: 같은 이메일 대기 초대가 있으면 revoke 대신 `resendInvitation` 경로로 위임하고 `{ resent: true }` 반환(역할 갱신 포함). 대기 상한 계산 그대로.
  - `resendInvitation(spaceId, invitationId, { role? })` 신설: 대기 상태만 대상. 쿨다운(`lastSentAt` + 60초) → 429 `resend_cooldown`, `sendCount >= 6`(최초 1 + 다시 보내기 5) → 429 `resend_limit`. 통과 시 토큰 재발급(`tokenHash`), `expiresAt = now + 7일`, `lastSentAt = now` 를 **조건부 updateMany**(`lastSentAt` 이 읽은 값과 같을 때만 — 동시 클릭 경합 방지)로 기록 후 새 토큰 반환.
  - `recordSendResult(id, ok)`: 성공 시 `sendCount` +1·`lastSendFailed=false`, 실패 시 `lastSendFailed=true`. 최초 생성은 `sendCount` 기본 1 이지만 최초 발송이 실패하면 0 으로 맞춘다(5회 판정은 성공만).
  - `listInvitations(spaceId)` (기존 `listPendingInvitations` 대체): 대기 전부 + `acceptedAt`/`revokedAt`/`expiresAt` 이 최근 30일 내인 행. `state`(`invitationState`), `lastSentAt`, `sendCount`, `lastSendFailed`, `acceptedAt`, `revokedAt`, 초대자 이름 포함. 이메일은 OWNER 화면이라 원문.
  - `Reason` 에 `resend_cooldown`·`resend_limit` 메시지 추가.
  - **`acceptInvitation` 경합 차단(Codex P1)**: 수락 시 조건부 `updateMany` 의 where 에 읽은 `tokenHash`·`role` 을 함께 넣는다(`id, tokenHash, role, acceptedAt:null, revokedAt:null, expiresAt>now`). 재발급·역할 갱신이 그 사이 끝났으면 0건 → `not_found`(이전 링크 무효)로 응답하고 구성원 생성은 같은 트랜잭션에서 하지 않는다.
- `src/lib/spaces/invite-email.ts`
  - `sendInviteEmail` 이 `already_registered` 판정 시 새 `sendMemberInviteEmail` 로 Resend 발송(지금은 skip). 반환 `{ sent: boolean, via: 'supabase'|'resend', reason? }`.
  - 다시 보내기 경로: 미가입자는 기존 Supabase 경로(`generateLink`+`invite_path` 갱신+`inviteUserByEmail`), 가입자는 Resend.
- `src/lib/spaces/member-invite-email.ts` (신규) — 결정 6 메일 HTML/텍스트(`renderEmail`, `emailBlocks`, `escapeHtml`). `idempotencyKey = invitation:{id}:{tokenHash 앞 16자}` — 토큰 발급마다 달라 재발급 후 이전 요청과 충돌하지 않는다(Codex P2). 같은 토큰을 짧은 시간에 두 번 보내는 경우만 Resend 가 하나로 합친다.
- `app/api/spaces/[spaceId]/invitations/route.ts`
  - GET: `requireSpaceOwner` 만(AAL2 제거), `listInvitations` 반환.
  - POST: 현행 guard(OWNER+AAL2). 응답에 `resent`, `emailSent`, `emailSkipReason`, `link`.
- `app/api/spaces/[spaceId]/invitations/[invitationId]/resend/route.ts` (신규) — POST, OWNER 만. `resendInvitation` → 메일 → `recordSendResult` → `{ link, emailSent, expiresAt }`. 감사 로그 `space.invitation.resend`.
- `.../[invitationId]/route.ts` DELETE — 변경 없음(OWNER+AAL2).

### 화면

- `src/components/settings/members-card.tsx`
  - 초대 목록: 이메일·역할·상태 배지(DESIGN §2.2 조합: 대기 amber, 수락 emerald, 만료·취소 muted)·보조 날짜(대기=만료일·마지막 발송, 수락=수락 일시, 만료=만료일, 취소=취소 일시)·「메일 실패」 표시.
  - 동작: 대기 → 「다시 보내기」·「취소」, 만료·취소 → 「다시 초대」(이메일·역할 채워서 초대 폼 제출 경로 재사용 — AAL2 필요), 수락 → 없음.
  - 안내 문구: 발송 성공 "초대 메일을 보냈습니다. 메일이 오지 않으면 아래 링크를 전달하세요.", 재초대 "이미 대기 중인 초대가 있어 다시 보냈습니다.", 실패 "메일을 보내지 못했습니다. 잠시 뒤 다시 보내거나 아래 링크를 복사해 전달하세요." 쿨다운·한도 오류는 서버 메시지 그대로.
  - 목록 로드 실패 시 MFA 안내 분기 제거(GET 이 더는 AAL2 를 요구하지 않음).

## 단계 (TDD)

1. 스키마 + 마이그레이션 + `prisma generate`.
2. `invitations.ts` 단위 테스트 먼저(red): 재초대=같은 행 갱신·역할 갱신, 쿨다운 429, 5회 한도 429, 성공만 카운트, 토큰 재발급 후 이전 토큰 `findInvitationByToken` 무효, 30일 목록 필터·상태, 동시 다시 보내기 하나만 성공, **재발급 직후 이전 토큰 수락 0건·역할 갱신 직후 이전 역할로 수락 불가**. → 구현(green).
3. 메일: `member-invite-email` 렌더 테스트(제목·이스케이프·링크·만료일), `sendInviteEmail` 가입자 분기 테스트(Supabase admin mock + `sendEmail` mock). → 구현.
4. API 라우트 테스트: GET OWNER 만(AAL2 없이 200, 비OWNER 403), POST 재초대 응답, resend OWNER·AAL2 없이 200·쿨다운 429·한도 429·실패 시 `emailSent:false`+link. → 구현.
5. `members-card` 테스트: 상태 배지·버튼 노출 규칙·다시 보내기 호출·안내 문구. → 구현.
6. `tsc`·`eslint`·관련 jest·`next build`.

## 검증

- 로컬 dev(같은 Supabase): QA 계정 2개로 가입자 초대 → `RESEND_API_KEY` 미설정이면 실패 표시+링크 복사 경로 확인, 링크로 수락 → 상태 「수락」. 다시 보내기 쿨다운·이전 링크 무효 확인.
- develop 머지 → main release(cherry-pick 후 **merge 직전 main 기준 tsc**, 마이그레이션은 Vercel `prisma migrate deploy`).
- 운영(결정 11): qa2 로 devops 초대(TOTP 코드는 스크립트 내부 생성·출력 금지) → kaleos 메일함 수신 확인(Ego 위임) → devops 수락 → 홈·사이드바가 「테스트」, 상태 「수락」 → qa2 로 devops 내보내기, 초대 이력은 남김.

## Codex 계획 리뷰 (2026-11-15)

- 지적 2건 — 반영 2, 보류 0
  - P1 재발급↔수락 경합: 수락 조건부 갱신에 `tokenHash`·`role` 일치 조건 추가(서버 절)
  - P2 idempotency key: 성공 횟수 대신 토큰 해시 기반(메일 절)

## 위험·고려

- 가입자 메일은 Resend 발신 도메인 평판·스팸함 가능 → 링크 복사 보조 유지(결정 2).
- 미가입자 다시 보내기의 GoTrue `invite_path` 갱신 실패(`stale_resend`)는 현행대로 메일 생략+링크 제공, `lastSendFailed=true`.
- 다시 보내기 AAL2 면제: 새 토큰을 OWNER 세션이 받는다 — 탈취 세션 위험은 초대 생성(AAL2)과 비교해 낮다고 판단(역할 변경은 재「초대」 경로=AAL2 로만). resend 는 역할을 바꾸지 않는다.
- 목록 GET AAL2 해제: 초대 이메일 목록 노출 범위는 OWNER 로 그대로.

## 롤백

- 코드: main revert PR. 스키마는 추가 컬럼 3개(nullable/기본값)라 구 코드와 호환 — 마이그레이션 롤백 불필요.
