# MFA(2단계 인증) 기기 분실 복구 런북

운영자(관리자 영역)와 Space ADMIN 이상이 자격증명을 저장·삭제할 때 TOTP 2단계 인증(aal2)을 요구한다.
처음 접근할 때 `/auth/mfa`에서 인증 앱을 등록한다.

## 적용 범위

- 관리자 영역(`/admin`, `/api/admin`) — 운영자
- 자격증명 쓰기 API(세션 요청만, 워커 토큰 경로는 제외)
  - `PUT /api/collection/credentials` — 쿠팡 로그인 자격
  - `PUT·DELETE /api/collection/api-credentials` — 쿠팡 Open API 자격
  - `POST·DELETE /api/sc/channels/[id]/credentials`, 그리고 자격증명이 있는 채널의 `DELETE /api/sc/channels/[id]`
  - `PUT /api/settings/ai`(키 저장·저장된 키로 BYOK 전환·공급자 변경), `DELETE /api/settings/ai`
- 조회, 일반 로그인, MCP 연결은 MFA를 요구하지 않는다.

## 기기를 잃어버렸을 때

인증 앱을 잃어버린 사용자는 스스로 해제할 수 없다(해제에 aal2가 필요하다). 운영자가 처리한다.

1. 요청자가 본인인지 Slack 등 별도 채널로 확인한다.
2. Supabase 대시보드 → Authentication → Users → 해당 사용자 → MFA factors 에서 factor 를 삭제한다.
3. 사용자에게 다시 로그인하라고 안내한다. 다음 접근 때 `/auth/mfa`가 등록부터 다시 진행한다.

## 비상 해제

Supabase MFA 장애 등으로 모두가 막히면 `ADMIN_REQUIRE_MFA=false`로 재배포한다. 운영자 게이트와 자격증명 게이트가 함께 풀린다. 원인을 해결한 뒤 바로 되돌린다.

## 알려진 한계

- `/auth/mfa` 등록 완료 시 남기는 감사 로그(`/api/admin/account/audit`)는 운영자만 기록된다. 운영자가 아닌 Space ADMIN 의 등록은 감사 로그에 남지 않는다.
