# 초대 인증 앱 완화(MEMBER) + 운영자 초대 다시 발급

작성: 2026-11-25 · 브랜치: `feat/invite-operator-link` (base `origin/develop` `abb4a631`)

## 목표

1. 고객 작업 공간 소유자가 **인증 앱(TOTP) 없이 MEMBER 초대 보내기·초대 취소**를 할 수 있게 한다.
   권한을 **주는** 동작(ADMIN 초대, 대기 초대의 ADMIN 상향)과 팀원 역할 변경·내보내기, 연동 키·비밀값·에이전트는 인증 앱 유지.
2. CS 대응: 워크덱 운영자가 어드민에서 고객 공간의 대기 초대를 **다시 발급**하고 링크를 복사해
   hello@ 메일로 초대받은 본인에게 직접 보낸다(AAK/accor.com VOC).

## 결정 기록

- 인증 앱 요구 지점 전수 조사(2026-11-25): `requireAal2` — invitations POST/DELETE, members PATCH/DELETE,
  collection·space credentials, cafe24·google install/callback, sc channels·osmu, settings/ai,
  agents·tokens·approval-limit, secrets 저장/삭제. `requireFreshAal2` — secrets reveal, env-secrets,
  admin platform google·recovery-key. 초대 다시 보내기(OWNER)는 이미 면제.
- ADMIN까지 해제하는 안은 Codex 계획 검토 지적(AAL1 탈취 세션으로 공격자를 ADMIN 초대)으로 MEMBER 한정으로 좁혔다(에디 승인).
- **운영자 "인증 포함 링크"(세션 발급)는 보류.** Codex 검토 critical(링크 보유=세션)·사고 회수 지적, 그리고 Resend→accor.com 전달 진단 미완.
  전달 진단 결과 수신사 격리로 확인되고 IT 허용으로도 안 풀리면 별도 계획으로 재검토
  (보호책 초안: 워크트리 밖 `workdeck-app/docs/superpowers/plans/2026-11-25-invite-operator-link-review.md`).
- 문자 인증은 범위 밖(추후 검토).
- Codex 재검토(2회차) 지적 1·2(ADMIN 초대를 MEMBER 재초대로 하향=사실상 취소, 역할 조회↔취소 경합):
  "ADMIN 초대 취소 AAL2" 조건을 빼서 해소. 취소·하향은 권한을 줄이는 동작이라 AAL1 탈취 시 피해가 초대 방해(DoS)에 그친다.
  상향은 요청 역할이 ADMIN일 때만 가능하고 그 요청은 항상 AAL2 → 경합 없음.

## 변경

### 1. 고객 초대 인증 앱 완화 (MEMBER 한정)
- `app/api/spaces/[spaceId]/invitations/route.ts`
  - `guard()`는 OWNER 확인만. 본문 파싱 뒤 `parsed.data.role === 'ADMIN'`이면 `requireAal2()`.
  - 같은 이메일 대기 초대 재초대는 `createInvitation` → `resendInvitation(role)`로 역할이 바뀐다.
    요청 역할이 ADMIN이면 AAL2라 상향은 막힌다. ADMIN→MEMBER 하향은 AAL1 허용(권한 축소).
  - 감사 로그 metadata에 `aal: 'aal1' | 'aal2'`(요청 시점 `isAal2Fresh()`)를 남긴다 — 사고 시 AAL1 초대 식별용.
  - 개인 공간 첫 초대가 팀 공간으로 전환되는 부수효과는 MEMBER 초대에서도 그대로 일어난다(현 동작 유지, 주석 갱신).
- `app/api/spaces/[spaceId]/invitations/[invitationId]/route.ts` (DELETE)
  - `requireAal2()` 제거(OWNER 확인만). 역할 무관 — 취소는 권한 축소. 감사 로그 추가 시 `aal` 기록.
- `src/components/settings/members-card.tsx` — 호출은 `fetchWithMfa` 유지(403 MFA_REQUIRED일 때만 단계 인증이 뜸).
  화면 문구에 "초대에 인증 앱 필요" 류 안내가 있으면 "관리자(ADMIN) 초대는 인증 앱 확인" 으로 정리.

### 2. 운영자 초대 다시 발급 (어드민)
- `src/lib/spaces/invitations.ts` `resendInvitation(..., opts)`에 `opts.ignoreSendLimit?: boolean` — MAX_SEND_COUNT(6)만 건너뛴다.
  쿨다운(60초)·pending 조건·원자적 claim 은 그대로.
- 신규 `GET /api/admin/spaces/[spaceId]/invitations` — `requireOperator()`(운영자+AAL2) → `listInvitations(spaceId)`.
- 신규 `POST /api/admin/spaces/[spaceId]/invitations/[invitationId]/resend` — `requireOperator()` →
  **감사 로그 먼저** `writeAuditLog(operatorId, 'space.invitation.operator_resend', 'space_invitation', id, { spaceId })`
  (실패 시 throw → 토큰 미교체, 기존 링크 유효. Codex 재검토 지적 3) →
  `resendInvitation(spaceId, id, { ignoreSendLimit: true })`(실패하면 감사 로그는 '시도' 기록으로 남는다) →
  `sendInviteEmail`(기존 다시 보내기와 같은 메일; 같은 링크라 혼선 없음, 도착하면 그것도 유효) → `recordSendResult`
  → `{ link, emailSent, expiresAt }`. 링크는 응답에서만 노출(저장 안 함, 기존과 동일). `inviterId`는 공간 OWNER가 아닌 운영자 ID가
  메일 "초대한 사람" 표기에 쓰이는지 확인하고, 쓰이면 원 초대자(`invitedById`)를 넘긴다.
- `src/components/admin/billing-space-detail.tsx`(어드민 공간 상세)에 「초대」 섹션 컴포넌트 1개:
  대기 초대 목록(이메일·역할·만료·발송 수·마지막 발송 실패) → 「다시 발급」 → 확인 다이얼로그
  ("이전 링크는 못 씁니다. 링크는 초대받은 본인 주소로만 보내세요") → 링크 + 「링크 복사」 + 메일 발송 결과.

## 범위 밖
- 세션 발급(인증 포함) 링크, 스키마 변경, 운영자 새 초대·취소, 그 밖 `requireAal2` 지점, 문자 인증.

## 검증
- jest 라우트 테스트:
  - invitations POST: AAL1+MEMBER 201, AAL1+ADMIN 403 MFA_REQUIRED, AAL1로 대기 MEMBER→ADMIN 재초대 403, 비OWNER 403/404.
  - invitations DELETE: AAL1로 MEMBER·ADMIN 초대 취소 성공, 다른 공간 초대 404, 비OWNER 거절.
  - AAL1 대기 ADMIN 초대를 MEMBER로 재초대 → 200·역할 MEMBER(하향 허용), 감사 metadata aal1.
  - members PATCH/DELETE AAL1 여전히 403(회귀).
  - admin GET/POST: 비운영자 404, 운영자 AAL1 403, 정상 시 토큰 교체·감사 로그·sendCount 한도 무시·쿨다운 429,
    감사 로그 실패 시 토큰 미교체(이전 tokenHash 유지).
  - `resendInvitation` ignoreSendLimit 분기 단위 테스트.
- `npx tsc --noEmit`, `npm run lint`, 관련 jest, `npm run build`.
- dev 수동: 인증 앱 미등록 소유자로 MEMBER 초대·취소 성공 / ADMIN 초대 시 단계 인증 표시. 어드민 다시 발급 → 링크 열림·이전 링크 무효.
- preview QA(테스트 계정) → main 릴리스 → 운영에서 AAK 건 처리.

## 위험·대응
- AAL1 탈취 세션으로 MEMBER 초대 가능 → 공격자가 MEMBER로 들어올 수 있다. 소유자 세션 탈취 자체가 이미 데이터 열람 가능 상태라
  추가 노출은 제한적. 감사 로그 `space.invitation.create` 유지.
- 운영자 오발송 → 다이얼로그 경고, 감사 로그, 링크는 받는 쪽 이메일 인증을 여전히 거쳐야 참여 가능(세션 미발급).

## 롤백·사고 대응
- PR revert(스키마 변경 없음). 긴급 시 invitations POST/DELETE 에 `requireAal2()` 한 줄 복원 — 이후 요청만 막는다.
- 이미 생긴 접근 회수: `AdminAuditLog`에서 배포 시각 이후 `space.invitation.create|resend` 중 metadata `aal=aal1` 건을 뽑아
  공간 소유자에게 확인 → 대기 초대 취소, 수락된 `SpaceMember` 제거, 개인→팀 공간 전환(`space.type.convert`, via invitation) 여부 확인.
  운영자 재발급 오발송은 `space.invitation.operator_resend` 기준으로 같은 절차(재발급으로 이전 링크 무효화 포함).
