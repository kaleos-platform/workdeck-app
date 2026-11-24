# 도입 문의 기반 가입 + 리드 가입 경로·어드민 안내 메일

작성: 2026-11-25 · 브랜치 `feat/lead-gated-signup` (origin/develop 기준)

## 배경

- 2026-11-24 신규 가입자(gmail)가 어드민 「도입 신청」 목록에 없었다. `User.signupSource` 는 utm 이 있을 때만 남아 null, GA4 `sign_up` 은 작업 공간 생성 때만 나가서 가입 경로를 알 수 없었다.
- 결정(에디, grill 2026-11-25): 신규 가입은 **도입 문의를 거친 이메일만**. 목적은 **기록**(모든 가입자의 연락처·유입 경로를 남김)이지 운영자 선별이 아니다 — 문의 직후 바로 가입할 수 있다. 가입 경로는 도입 문의의 utm·referrer 를 쓴다.

## 확정 규칙

1. **가입 허용 = 이메일 일치.** 신규 User 생성 시 그 이메일(대소문자 무시)로 된 `MarketingLead` 중 `DROPPED` 아닌 행이 있으면 허용. 기간 제한 없음. 보안 경계가 아니라 퍼널 기록 장치다(Codex critical 지적 → 목적 확정으로 수용).
2. **예외**: 이미 User 가 있는 기존 가입자, 작업 공간 초대 수락(기존 `acceptInvitation` 원자적 수락 경로).
3. **상태 자동 전환** (`DROPPED` 는 운영자 수동 표시만), 모두 현재 상태 조건부 `updateMany`:
   - 어드민 안내 메일 발송 성공 → 그 이메일의 `NEW` 행 → `CONTACTED`.
   - User 생성 → 그 이메일의 `NEW`·`CONTACTED` 행 → `CONVERTED` (User 생성과 같은 트랜잭션).
   - `DROPPED` 행은 발송 불가(라우트에서 거부, 버튼 비활성).
4. **가입 경로**: User 생성 시 그 이메일의 가장 오래된 비종료 리드의 utm·referrer 를 `User.signupSource` 에 복사(`landing: 'lead'`). 리드 없는 초대 가입은 기존 `{ utm_source: 'invite' }`.
5. **referrer 정리**: 리드 저장 시 자기 도메인(`workdeck.work`, `*.workdeck.work`) referrer 는 null — `app/api/hiring-public/applications/route.ts` 와 같은 방식.

## 가입 진입 흐름

- 공개 「가입 가능 여부」 API는 **만들지 않는다**(리드 명단 조회 수단이 됨 — Codex high).
- 대신 **서명된 가입 링크**: 리드 저장 시 `HMAC(leadId)` 토큰을 만들어 `/signup?lead=<leadId>.<sig>` 로 보낸다. 키는 기존 서버 비밀(`ENCRYPTION_KEY` 파생, 신규 env 없음). 만료 없음(규칙 1), 리드가 `DROPPED` 면 무효.
  - 도입 문의 완료 화면에 「바로 가입하기」 버튼.
  - 신청자 접수 메일의 「바로 시작하기」를 이 링크로 교체.
  - 어드민 안내 메일의 「가입하기」도 이 링크.
- `/signup` 화면:
  - 유효한 `lead` 토큰 → 이메일을 미리 채우고 고정(리드 이메일), 일반 가입 폼 + Google 버튼(「이 이메일의 Google 계정으로」 안내).
  - 토큰 없음/무효 → 가입 폼 대신 「워크덱은 도입 문의 후 가입할 수 있습니다」 + 「도입 문의하기」 + 「이미 문의했다면 Google 계정으로 계속」(Google 은 이메일 소유가 증명되므로 서버 가드만으로 판정, 명단 노출 없음).
  - `?blocked=lead` → 「도입 문의에 남긴 이메일과 다른 계정입니다」 안내.
- 이메일 가입 시 `user_metadata.lead_token` 도 싣는다(다른 기기 인증 대비). 서버 가드는 토큰이 아니라 이메일 일치로 판정한다 — 토큰은 UX·명단 비노출용.

## 변경 파일과 단계

### 1. 공용 모듈 `src/lib/marketing/lead-signup.ts` (신규)

- `isLeadGateEnabled()` — env `SIGNUP_REQUIRES_LEAD !== 'off'`. **모든 가드 지점이 이것 하나만** 본다.
- `findSignupLead(email, tx?)`, `leadSignupSource(lead)`, `markLeadsConverted(email, tx)`, `markLeadsContacted(email)` (조건부 updateMany).
- `signLeadToken(leadId)`, `verifyLeadToken(token)` (timingSafeEqual).
- 테스트: 종료만 있으면 거부, 최초 리드 선택, CONVERTED 미하향, 토큰 위조·DROPPED 무효, 플래그 off.

### 2. `src/lib/marketing/signup-source.ts`

- `referrer`(300자) 키 추가, `utm_source` 없어도 `referrer` 또는 `landing==='lead'` 면 보존. 테스트 갱신.

### 3. User 생성 지점

- `app/auth/callback/route.ts` (Google): 기존 User 면 그대로. 신규면:
  - 리드 있음 → 트랜잭션에서 User 생성(리드 출처) + `markLeadsConverted`.
  - 리드 없음 + `next` 가 `/invite/` → **User 를 만들지 않고** 수락 화면으로 보낸다. User 는 `acceptInvitation` 의 원자적 수락에서 생성(초대 취소·재발급 경합 회피 — Codex high). 수락 화면·accept API 가 Prisma User 없이 동작하는지 구현 시 확인.
  - 그 외 → `signOut()` 후 `/signup?blocked=lead`.
- `src/lib/workspace.ts` `ensureWorkspaceForUser` (이메일 가입자의 첫 User 생성): 신규 User 면 같은 판정, 불가면 `SignupNotAllowedError` → `app/api/workspace/route.ts`·`app/api/collection/credentials/route.ts` 에서 403 + 안내. 허용이면 같은 트랜잭션에서 출처 복사·전환.
- `src/lib/spaces/invitations.ts` `acceptInvitation`: User **create** 분기에서 리드가 있으면 출처 = 리드, 같은 tx 에서 `markLeadsConverted`. 리드 없으면 기존 `invite`.
- 인증만 있고 Prisma User 없는 세션: `app/(auth)/workspace-setup` 진입 시 위 가드에 걸려 안내로 보낸다. 그 밖의 세션 전용 API(예 `POST /api/spaces`)는 FK 로 실패한다 — 목적이 기록이라 공통 경계 강제는 범위 밖(Codex high 보류, 이유: 보안 경계 아님·변경 범위 과대). 구현 시 `rg "getUser\(" app/api` 로 User 없이 **쓰기에 성공**하는 라우트가 있는지만 점검하고, 있으면 그 라우트에만 가드.

### 4. 가입·리드 화면

- `src/components/auth/signup-form.tsx`, `app/(auth)/signup/page.tsx`: 위 「가입 진입 흐름」.
- `src/components/marketing/landing/lead-form.tsx`: 완료 화면에 「바로 가입하기」(API 응답의 `signupUrl`). `app/api/public/leads/route.ts` 가 `signupUrl` 반환 — 10분 중복 접수일 때는 기존 행의 링크.
- `src/lib/marketing/lead-notify.ts` 「바로 시작하기」 → 서명 링크, 문구 「신청한 이메일로 가입해 주세요」.
- 마케팅 `/signup` 직행 CTA(`app/(marketing)/page.tsx`·`about`·`pricing`, `marketing-header.tsx`, `src/lib/marketing/decks/*.ts` primaryCta) → 도입 문의 폼(각 랜딩 `#lead-form`, 없는 곳은 모집 관리 랜딩 `#lead-form`).

### 5. 어드민 도입 신청 (`app/admin/leads/page.tsx`, `src/components/admin/leads-table.tsx`, `app/api/admin/leads/[id]/`)

- 열 추가: 「유입 경로」(utm_source/medium 또는 referrer 호스트, 전체는 툴팁), 「같은 이메일 신청 N회」, 「가입함」(같은 이메일 User 가입일).
- 「안내 메일 보내기」 → 다이얼로그(고정 본문 + 「가입하기」 서명 링크 + 운영자 메시지 선택·300자·일반 텍스트 이스케이프·링크 자동 변환 없음 + 미리보기) → `POST /api/admin/leads/[id]/send-invite`.
  - 운영자 권한, `DROPPED` 거부, `sendEmail`+`renderEmail`, `replyTo` 운영 메일.
  - **멱등 키 = 정규화 수신 주소 + KST 날짜**(리드 id 아님) → 같은 주소 중복 리드로 여러 번 못 보냄(Codex high).
  - 발송 기록: `MarketingLead.invitedAt`·`invitedBy`(운영자 id). 순서: 발송 → 조건부 상태·기록 갱신. DB 갱신 실패 시 500 + 「메일은 나갔을 수 있음, 다시 눌러도 같은 날은 중복 발송 안 됨」 — 재시도가 멱등 키로 안전(Codex high 반영: 별도 발송 테이블은 과대, 멱등 키+재시도로 대체).
- `/admin/users` 「가입 경로」: `landing==='lead'` 면 「도입 문의 · <utm 또는 referrer 호스트>」.

### 6. 마이그레이션

- `npx prisma migrate dev --name marketing_lead_invited` — `MarketingLead.invitedAt DateTime?`, `invitedBy String?`.

## 검증

- 단위: lead-signup(플래그 off 포함), signup-source, send-invite(권한·DROPPED·주소 멱등·상태 조건부), callback(신규 리드/무리드/초대 next/기존), ensureWorkspaceForUser, acceptInvitation(리드 유무별 출처·전환), leads POST `signupUrl`·자기 도메인 referrer.
- `npm run lint`, `npx tsc --noEmit`, 관련 jest.
- 로컬 dev 수동: ① 무토큰 `/signup` → 문의 안내 ② 리드 제출 → 바로 가입하기 → 이메일 고정 가입 → signupSource=리드, 리드 CONVERTED ③ 리드 없는 Google → 로그아웃·blocked 안내 ④ 어드민 발송 → CONTACTED·invitedAt, 같은 날 재발송 중복 없음 ⑤ 초대 가입(리드 없음/있음) ⑥ `SIGNUP_REQUIRES_LEAD=off` 에서 ①~③ 기존 동작 복구.

## 위험·롤백

- **정상 가입 차단**: 가드 버그 시. 롤백 = Vercel env `SIGNUP_REQUIRES_LEAD=off` + 재배포(에디 승인) — 모든 가드가 `isLeadGateEnabled()` 하나를 보므로 일괄 해제. off 일 때 `/signup` 은 기존 폼, CTA 는 문의 폼 유지(무해).
- **문의 직후 가입 가능**: 의도(기록 목적). 스팸 리드는 운영자가 `DROPPED` 로.
- **Supabase 인증만 있는 고아 사용자**: 직접 `signUp` API 호출 시 생길 수 있음. 앱 데이터 접근은 위 3의 점검 범위로 제한. 근본 차단(Before User Created Hook)은 운영 Supabase 설정 변경이라 후속.
- **gmail ↔ 회사 메일 불일치**: 다시 문의하거나 운영자가 리드 추가. 잦으면 「가입 허용 이메일 추가」 후속.
- 마이그레이션은 nullable 컬럼 2개 추가뿐 — 되돌리기 안전.

## Codex 적대적 리뷰 (2026-11-25) — 지적 8건

| #   | 등급     | 지적                                   | 처리                                                                       |
| --- | -------- | -------------------------------------- | -------------------------------------------------------------------------- |
| 1   | critical | 공개 리드 제출만으로 가입 가능         | 수용 — 목적=기록(에디 확정), 규칙 1에 명시                                 |
| 2   | high     | 인증만 있는 사용자 접근 범위 미검증    | 부분 반영 — 쓰기 성공 라우트만 점검·가드, 공통 경계는 보류(보안 경계 아님) |
| 3   | high     | acceptInvitation 경로의 출처·전환 누락 | 반영 — 3단계                                                               |
| 4   | high     | eligibility API 명단 노출              | 반영 — API 제거, 서명 링크                                                 |
| 5   | high     | 초대 확인·User 생성 경합               | 반영 — 콜백에서 초대 예외 User 미생성, acceptInvitation 에 위임            |
| 6   | high     | 어드민 메일 스팸·피싱·중복 리드 우회   | 반영 — 주소 기준 멱등, 메시지 300자·링크 없음, invitedBy 감사              |
| 7   | high     | 발송·상태 저장 부분 실패               | 부분 반영 — 조건부 갱신 + 멱등 재시도, 발송 기록 테이블은 보류(과대)       |
| 8   | medium   | 롤백 플래그 적용 범위                  | 반영 — `isLeadGateEnabled()` 단일 지점 + off 검증                          |

## 범위 밖

- 가입 시점 GA4 `sign_up` 분리, Before User Created Hook, 중복 리드 병합, 공통 인증 경계(Prisma User 강제).

## 구현 및 검증 기록 (2026-11-25)

- 승인된 권장안대로 Google 버튼을 유지하고, 서명 링크로 진입한 이메일은 읽기 전용으로 고정했다.
- User 생성·리드 출처·전환은 `ensureSignupUser(tx)`에 모았다. 기존 User·초대 수락 예외와 플래그 off를 유지한다.
- 인증만 있는 세션이 `workspace-setup → signup → my-deck`을 반복하지 않도록 proxy에서 정확한 차단 안내 경로를 허용했다. 다른 계정 로그인은 로그아웃 후 진행한다.
- 종료 리드는 중복 접수 대상에서 제외한다. 메일 발송 후 목록은 갱신된 서버 상태를 표시한다.
- 어드민 메일은 같은 이메일의 최초 활성 리드 링크와 `/my-deck` 목적지를 사용해 중복 리드에서도 본문을 일정하게 유지한다. 신청자 접수 메일은 신청 업무의 구독 목적지를 유지한다.
- 같은 날 이미 기록된 발송은 다시 보내지 않는다. 동시 요청은 조건부 갱신을 얻은 요청 하나만 상태·발송 이력·감사를 기록한다. `invitedBy`는 발송과 기록 작업을 완료한 운영자이며, Resend에서 최초 요청을 생성한 운영자를 증명하는 값은 아니다. 발송 후 DB 실패의 재시도 방식에 따른 한계다.
- 별도 명세·품질 리뷰에서 발견한 중복 접수, 상태 표시, 계정 전환, 발송 기록 문제를 수정하고 재검토 승인을 받았다.

### 마이그레이션

`20261124160356_marketing_lead_invited`는 `prisma migrate dev --name marketing_lead_invited`로 생성했다. 실제 자격 증명을 사용하지 않도록 HEAD schema baseline과 별도 config로 일회용 로컬 PostgreSQL에 생성·적용했고, `prisma migrate diff --exit-code`에서 차이 없음(exit 0)을 확인했다. Prisma Client도 재생성했다.

기존 전체 이력의 빈 DB 재생 문제와 이번 변경의 검증을 분리했다. 공유 개발·운영 DB에는 적용하지 않았으며, 운영 배포도 실행하지 않았다.

### 검증

- 관련 가입·리드·auth·초대 회귀: 24 suites / 198 tests 통과.
- 전체 lint: 오류 0건, 기존 경고 62건. TypeScript typecheck 통과.
- Ego 실화면: 무토큰 가입 안내, 차단 안내 desktop·390px, 합성 데이터의 어드민 표·안내 메일 미리보기·이메일 읽기 전용 가입 폼 확인. 실메일 발송·실제 리드 생성·로그인 제출 없이 진행했고 임시 fixture는 삭제했다.
- axe: 어드민 표의 Select 이름 누락을 수정한 뒤 serious/critical 0건, 미리보기 modal 위반 0건. 기존 인증 레이아웃 landmark moderate 2건 및 dev react-grab canvas region moderate는 이번 범위 밖으로 남겼다.
- production build 통과: 컴파일 15.1초, TypeScript 47초, 정적 페이지 403개 생성 완료, exit 0. 기본 sandbox에서 compiler worker가 대기해 해당 실행을 종료하고, 같은 소스·명령을 정식 권한으로 실행해 검증했다. 코드나 build 설정은 바꾸지 않았다.
- 실제 OAuth·메일 실수신과 공유 DB 기반 동시성 E2E는 실행하지 않았다.
