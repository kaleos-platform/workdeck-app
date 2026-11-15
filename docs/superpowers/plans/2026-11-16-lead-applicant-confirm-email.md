# 도입·출시 알림 신청자 접수 확인 메일

작성: 2026-11-16. 브랜치 `feat/lead-applicant-confirm` (origin/develop `d7e4a2ae`).

## 배경

사용자 보고: workdeck.work/recruiting 에서 도입 신청 후 메일이 오지 않음.
점검 결과 `/api/public/leads` 는 저장 후 **운영자 알림**(Slack + `hello@workdeck.work` 메일)만 보내고, **신청자에게 보내는 메일은 구현돼 있지 않다**. 랜딩은 「24시간 안에 이메일로 안내」라고 약속한다.

## 목표 (grill 확정)

1. 신청자에게 접수 확인 메일 1통.
   - 공개 업무(도입 신청): 제목 「[워크덱] {업무명} 도입 신청이 접수됐습니다」. 본문 = 접수 안내 · 「담당자가 24시간 안에 이메일로 이용 방법을 안내」 · 신청 내용 요약(업무·회사명·이름, **연락처·이메일 제외**) · 「바로 시작하기」 버튼(가입 → `/my-deck?subscribe={deck}` 랜딩의 startHref 와 동일) · 문의는 회신.
   - 준비중 업무(출시 알림 신청): 제목 「[워크덱] {업무명} 출시 알림 신청이 접수됐습니다」, 「출시되면 이메일로 알려드립니다」, 바로 시작 버튼 없음.
   - 공개 여부는 서버에서 `getReleasedDeckIds()`(업무 공개 판정 단일 출처)로 판정. 클라이언트 값 신뢰 안 함.
2. 발신 `Workdeck <noreply@workdeck.work>`, `replyTo` = 운영 수신 주소(`LEAD_NOTIFY_TO` ?? `hello@workdeck.work`).
3. 디자인: 기존 공용 `renderEmail`(워크덱 헤더). 신청자 이름·회사명은 escape(레이아웃이 처리).

## 악용 방어 (남의 이메일 입력)

- 기존 허니팟·IP 레이트리밋·같은 이메일+업무 10분 중복 무시·시간당 30건 초과 시 알림 생략을 그대로 적용(확인 메일도 같은 분기 안에서만 발송).
- Resend `Idempotency-Key` = `lead-confirm:{deck}:{email 소문자}:{KST 날짜}` → 같은 주소·업무는 하루 1통.
- 본문에 연락처·이메일 등 추가 PII 를 넣지 않는다(오입력 수신자에게 노출 최소화).

## 변경 파일

- `src/lib/marketing/lead-notify.ts`: `notifyApplicant(lead, { released })` 추가.
- `app/api/public/leads/route.ts`: `Promise.allSettled([notifySlack, notifyEmail, notifyApplicant])`. 실패는 기존처럼 로그만(접수 성공 유지).
- `src/components/marketing/landing/deck-landing.tsx`·`src/lib/marketing/decks/recruiting.ts`(필요 시 다른 deck 파일): 완료 문구에 발송을 단정하지 않는 안내 추가: 「확인 메일이 보이지 않으면 스팸함을 확인하거나 hello@workdeck.work 로 알려 주세요」 (중복·시간당 초과·발송 실패 경로에서도 거짓이 되지 않게).
- 테스트: `src/lib/marketing/__tests__/lead-notify.test.ts`, `app/api/public/leads/__tests__/route.test.ts`.

## 단계 (TDD)

1. lead-notify 단위 테스트: 공개/준비중 제목·본문·버튼 유무, PII 제외, replyTo, idempotency key, 이름 escape.
2. route 테스트: 정상 접수 시 3종 호출, 중복·허니팟·시간당 초과 시 미발송, 신청자 메일 실패해도 201.
3. 구현 → lint·tsc·관련 jest.
4. develop PR → main 릴리스, 운영에서 내 주소로 실제 신청 1건 → 신청자·운영자 메일 수신 확인 후 그 리드는 어드민에서 정리.

## 검증

- 단위·라우트 테스트, tsc, eslint.
- 운영 실수신: 신청자 메일(제목·버튼 링크·회신 주소), 운영자 알림 메일·Slack 정상.

## 위험·롤백

- 발송 실패는 접수에 영향 없음(allSettled). 문제 시 route 의 `notifyApplicant` 한 줄 제거로 즉시 롤백.
- 도메인 평판: 위 방어 + 하루 1통 제한.

## 리뷰 반영

Codex 리뷰: 지적 1건 — 반영 1, 보류 0.
- P2 완료 문구가 발송을 단정 → 발송 여부와 무관하게 참인 안내 문구로 변경.
