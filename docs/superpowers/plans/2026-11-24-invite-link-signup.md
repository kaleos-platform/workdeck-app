# 초대 링크로 들어온 신규 회원 가입 단계

## 배경

- 소유자가 「팀원·권한」에서 초대 링크(`/invite/<token>`)를 복사해 메신저로 전달하는 경우가 있다(초대 메일이 기업 메일 보안 장비에 막힘).
- 지금 초대 화면의 익명 상태는 「가입하기」(일반 `/signup`으로 이동)·「로그인」·Google 버튼만 있다. 문제:
  1. 초대 때 Supabase `inviteUserByEmail`로 auth 사용자가 이미 만들어진 사람은 `/signup`에서 가입해도 Supabase가 메일을 보내지 않는다(성공처럼 보이는 막다른 길).
  2. 일반 가입 인증 메일은 Supabase `ConfirmationURL`이라 보안 장비 선방문에 소비된다.
- 결정(에디, 2026-11-24): 링크로 들어온 경우 **초대 이메일과 일치하는지 확인**하고, 가입 단계에서 **이메일 인증을 다시 거친다**. 링크만으로 인증을 대신하지 않는다.

## 목표 흐름 (초대 화면, 로그인 안 한 상태) — Codex 검토 후 재설계

```
[「AAA」에 초대되었습니다 · 초대받은 이메일: ab***@company.com]

 처음이신가요? 이메일 인증하고 참여하기
  초대받은 이메일 [            ]   ← 직접 입력, 초대 이메일과 같아야 함
  [인증 메일 받기]

 ── 또는 ──  [Google 계정으로 참여하기]
 이미 계정이 있나요? [로그인]
```
- 제출 후: 「인증 메일을 보냈습니다. 메일의 버튼을 누르면 이 화면으로 돌아와 비밀번호를 정하고 참여합니다. 메일이 안 보이면 스팸함·회사 격리함 확인」 + 「다시 보내기」(60초 간격).
- 메일 버튼 → `/auth/confirm` 확인 화면(선방문 안전) → 「계속하기」 → 로그인된 채 `/invite/<token>` → 기존 `needs_password` 화면에서 비밀번호 정하고 참여.
- **비밀번호는 이메일 인증(세션) 뒤에만 정한다.** 가입 폼에서 비밀번호를 받지 않는다(Codex critical).

## 상태표 (auth 사용자 기준, 위에서부터 첫 일치)

| 상태 | 처리 | 인증 후 화면 |
|---|---|---|
| auth 사용자 없음 | `generateLink({type:'invite', email, options:{data:{invite_path}}})` → 사용자 생성(비밀번호 없음, invited_at 설정) | needs_password |
| 있음 + 미인증 | 같은 `generateLink('invite')` (기존 `sendInviteEmail`이 이미 쓰는 호출, 재초대 시 invite_path 갱신 패턴 동일) | needs_password(invited_at 있음) |
| 있음 + 인증됨 + 앱 `User` 행 있음 | 발송 안 함, 409 `registered` → 「이미 워크덱 계정이 있습니다. 로그인해서 참여하세요」+로그인·비밀번호 찾기 | — |
| 있음 + 인증됨 + 앱 `User` 행 없음 (초대 링크를 보안 장비가 먼저 써 버린 경우 등) | `generateLink({type:'magiclink'})` | invited_at 있고 password_set 없으면 needs_password, 아니면 ready |

- `generateLink('invite')`가 `email_exists`를 주면(인증된 사용자) 아래 두 행으로 분기 — 미인증/인증 판정을 따로 조회하지 않고 기존 `sendInviteEmail`과 같은 오류 판정(`email_exists` 또는 422+"already been registered")을 재사용.
- 링크: `${origin}/auth/confirm?token_hash=<properties.hashed_token>&type=<invite|magiclink>&next=/invite/<token>`. verifyOtp type은 generateLink type과 같은 값(`invite`/`magiclink`) — 기존 초대 템플릿이 `type=invite`+TokenHash로 운영 중인 것과 같은 짝.
- 앱 `User` 행 판정: `prisma.user.findUnique({ where: { id: authUserId } })` (auth id = User.id, `/auth/callback` upsert 기준).

## 변경

1. `app/api/invitations/[token]/signup/route.ts` (신규, POST, 로그인 불필요)
   - 입력 Zod: `email`만.
   - `findInvitationByToken` → pending 아니면 410.
   - `normalizeEmail` 불일치 → 400 `email_mismatch`. 응답에 이메일 원문 없음.
   - **발송 제한은 소유자 한도(sendCount)와 분리**(Codex high): `AdminAuditLog`(`action='space.invitation.self_verify'`, `targetType='space_invitation'`, `targetId=invitation.id`, 인덱스 있음)로 최근 60초 1회·1시간 5회 제한 + 기존 `checkRateLimit(publicRequestKey(req))` IP 제한. 소유자의 `sendCount`/`lastSentAt`은 건드리지 않는다 → 토큰 보유자가 소유자 재발송을 막을 수 없다.
   - 발송 직전 초대를 다시 조회해 pending·tokenHash가 그대로인지 확인(소유자가 그 사이 재발급하면 409 `stale` → 「초대한 분께 새 링크를 받으세요」).
   - 메일 발송 실패 → 502 `send_failed`, 사용자는 다시 시도(쿨다운 기록은 성공 시에만). generateLink로 생긴 미인증 auth 사용자는 남아도 다음 시도·소유자 재초대에서 같은 경로로 재사용되므로 정리 불필요.
2. `src/lib/spaces/invite-signup-email.ts` (신규) — `renderEmail`, 버튼 「이메일 인증하고 참여하기」, 1시간 유효, fallback 링크.
3. `app/auth/confirm/route.ts` — 변경 없음(`invite`·`magiclink`는 이미 세션 유지 후 next로 이동).
4. `src/components/invite/invite-accept.tsx` — `anonymous` 화면에 이메일 폼·보낸 뒤 상태·다시 보내기. 일반 `/signup` 링크 제거. Google·로그인 유지. `/forgot-password` 안내 문구는 「이미 계정이 있다면」으로 축소.
5. 테스트: route(불일치 400·만료 410·쿨다운 429·IP 429·신규/미인증→invite, 인증+User행→409, 인증+User행없음→magiclink, stale 409, 발송 실패 502·쿨다운 미기록), invite-accept 폼(불일치·보낸 뒤 화면·409 문구), **비밀번호를 받지 않는다** 확인.

## 범위 밖
- 소유자 초대 메일 자체(`sendInviteEmail`)는 그대로. 다만 이 계정 생성 구조 때문에 생기는 막다른 길은 위 「초대만」 분기로 해소.

## 검증
- jest·tsc·lint.
- dev(`tumk…`, Resend SMTP)에서: 새 이메일로 초대 → 링크 복사 → 시크릿 창 → 불일치 이메일 거부 → 일치 가입 → 메일 수신 → curl로 링크 GET 먼저 → 브라우저 「계속하기」 → 초대 화면 로그인 상태 → 참여 → `/my-deck`.
- 이미 초대 메일로 auth 사용자가 생긴 이메일로 같은 흐름 → 로그인 링크 메일 → 비밀번호 정하기 → 참여.

## 위험·롤백
- 메일 폭탄: 초대 이메일로만 발송 + 초대당 60초·시간당 5회 + IP 제한. 소유자 한도와 분리.
- 계정 탈취: 비밀번호는 메일 인증 세션 뒤에만 설정 → 링크가 새도 메일함 없이는 불가.
- 이미 쓰던 계정(User 행 있음)에는 로그인 링크를 보내지 않는다(로그인 요구).
- 롤백: 코드 revert만(스키마·운영 설정 변경 없음).

## Codex 검토 반영 (2026-11-24)

지적 4건 — 반영 4, 보류 0.
1. [critical] 인증 전 비밀번호 설정 → 폼에서 비밀번호 제거, 인증 세션 뒤 needs_password에서만 설정.
2. [high] 분기 겹침 → 상태표로 우선순위 고정(generateLink invite 먼저, email_exists일 때만 User 행으로 분기).
3. [high] 소유자 한도 소진 → 감사 로그 기반 별도 한도 + IP 제한, sendCount 불변.
4. [medium] 재발급 경쟁·발송 실패 → 발송 직전 tokenHash 재확인(stale 409), 실패 시 쿨다운 미기록·재시도.
