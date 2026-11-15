# 모집 관리: 자주 쓰는 메시지 복구 · 공고 작성 3단계 · 지원서 상단 공고 정보

2026-11-15 grill 확정. #1446에서 지운 메시지 템플릿을 「자주 쓰는 메시지」로 되살리고, 공고 작성 단계와 공개 지원서 화면을 오프닝 흐름에 맞춘다.

## 결정

| 항목             | 결정                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| 메시지 사용 위치 | 지원자 상세 「문자 보내기」(오프닝 방식 `sms:` 링크) + 「상태 알림」 창 빠른 채우기                     |
| 관리 위치        | 설정 > 「메시지 관리」 탭 (`/d/recruiting/settings/messages`)                                           |
| 기본 메시지      | 자동 생성 안 함. 빈 목록에 「예시 메시지 3개 추가」 버튼(서류 합격·면접 안내 / 최종 합격 / 불합격 안내) |
| 치환 변수        | `{이름}` `{공고명}` `{직무}` — 보낼 때 지원자 값으로 바꿈                                               |
| PC에서 문자      | `sms:`는 PC에서 열리지 않으므로 「메시지 복사」 + 번호 표시. 모바일(터치 기기)은 문자 앱 열기           |
| 공고 작성 단계   | 공고 기본 정보 → 지원서 작성 → 공고 꾸미기 (3단계)                                                      |
| 마감일 위치      | 1단계 기본 정보로 이동                                                                                  |
| 지원서 상단      | 공개 지원서 `/p/[uuid]/apply` 상단에 공고명·모집 직무·모집 장소·마감일 표시                             |

## 1. 자주 쓰는 메시지

- **스키마:** 새 마이그레이션으로 `HiringMessageTemplate`(id, spaceId, title, content, createdAt, updatedAt, `@@index([spaceId])`, Space cascade) 다시 만들기. 이전 모델의 `lastUsedAt`은 쓰던 곳이 없어 뺀다. `migrate dev`(shadow 실패 시 수동 SQL + `migrate deploy`, memory 참고).
- **API:** `app/api/hiring-applicants/message-templates/route.ts`(GET 읽기 권한·POST 쓰기 권한), `[id]/route.ts`(PATCH·DELETE 쓰기 권한, spaceId 스코프) — `14d14cad^` 버전 복원. `messageTemplateSchema`(title 1~50, content 1~1000) 복원. POST에 `{ samples: true }`가 오면 예시 3개를 한 트랜잭션으로 만든다. 트랜잭션 첫 줄에서 `pg_advisory_xact_lock(hashtext('hiring-msg-samples:'||spaceId))`를 잡고 개수를 확인한다(이미 1개 이상 있으면 409).
- **화면:** `src/components/hiring-applicants/templates-manager.tsx` 복원 → 「메시지 관리」 문구로, 빈 상태에 예시 추가 버튼, 변수 안내 한 줄. `settings-tabs.tsx`에 3번째 탭, `app/d/recruiting/settings/messages/page.tsx`. 옛 `/d/recruiting/message-templates` redirect 대상은 지원자 목록 → 메시지 관리 탭.
- **치환:** `src/lib/hiring/message-template.ts` `fillMessage(content, { name, postingTitle, positionName })` — 없는 값은 빈 문자열. 단위 테스트 1개.
- **문자 보내기:** `src/components/hiring-applicants/sms-sender.tsx`(client). 지원자 상세 「액션」 카드에 버튼 → 메시지 목록 선택 → 치환된 본문 미리보기·편집 → 「문자 앱 열기」(`sms:${digits}?&body=${encodeURIComponent(body)}`, 번호는 숫자만 남기고 9~11자리가 아니면 문자 앱 버튼을 숨긴 뒤 복사만 허용), 「메시지 복사」. 메시지가 없으면 「설정 > 메시지 관리」 링크.
  - PII: 상세 페이지는 이미 연락처를 HTML로 렌더한다. 문자 앱 링크에 번호가 필요해 phone·name을 이 client island에만 prop으로 넘긴다(로그·외부 전송 없음, AI 미전달). 연락처가 없으면 버튼 비활성.
- **상태 알림:** `notification-sender.tsx`에 「자주 쓰는 메시지」 칩 복원(치환 적용). 치환용 name·공고명·직무를 prop으로 받는다.
- 랜딩 문구는 이번 범위 밖(요청 없음).

## 2. 공고 작성 3단계

- `wizard-stepper.tsx`: `WIZARD_STEPS = basic(공고 기본 정보) / form(지원서 작성) / decorate(공고 꾸미기)`. 별도 「지원서 설정」 버튼과 안내 문구 제거(발행 후 잠금 안내는 잠금 notice로 이미 표시).
- `build-wizard.tsx`: 기본 정보 단계에 「지원서 마감일」 섹션(`StepFormSettings`) 이동, 잠금 상태 읽기 전용 목록에 마감일 추가. form 단계는 지원서 항목 + 지원 알림 메일 설정(`PostingMailSettings`, 발행 후에도 편집 가능, 그대로 유지) + 미리보기, 하단 이전/다음 공통 버튼. 마감일 저장 실패나 과거 날짜일 때는 다음 단계로 넘어가지 않고 입력을 유지한다(기존 `afterSaving` 동작, 테스트 추가). 기본 항목 그대로 「다음」 가능(외부 채용사이트용 HTML만 만드는 경우).
- 기존 테스트(`__tests__`의 wizard 관련) 갱신.

## 3. 공개 지원서 상단 공고 정보

- `app/p/[uuid]/apply/page.tsx` 헤더: 공고명 아래 `dl`로 모집 직무(이름 나열)·모집 장소(매장명 나열, 없으면 행 생략)·마감일(`YYYY.MM.DD 마감`, 없으면 「상시 모집」). 현재 페이지가 `spaceId === posting.spaceId`로 거른 `positions`·`stores`만 사용하고 원본 관계는 쓰지 않는다(공개 페이지 테넌트 경계). 쿼리 변경 없음.
- 위저드 2단계 미리보기 `application-form-preview.tsx`도 같은 정보(직무·장소)를 보여 실제 화면과 맞춘다.

## 변경 파일

prisma/schema.prisma, prisma/migrations/2026111516xxxx_recreate_hiring_message_template/, app/api/hiring-applicants/message-templates/(route.ts, [id]/route.ts), src/lib/validations/hiring-applicants.ts, src/lib/hiring/message-template.ts(+test), src/components/hiring-applicants/(templates-manager.tsx, sms-sender.tsx, notification-sender.tsx), app/d/recruiting/settings/messages/page.tsx, src/components/hiring-posts/settings-tabs.tsx, app/d/recruiting/message-templates/page.tsx, app/d/recruiting/applications/[id]/page.tsx, src/components/hiring-posts/(wizard-stepper.tsx, build-wizard.tsx, application-form-preview.tsx), app/p/[uuid]/apply/page.tsx, 관련 테스트.

## 단계·검증

1. 메시지(스키마→API→설정 탭→문자 보내기·상태 알림) — jest(API 권한·스코프·예시 409, fillMessage), dev 화면 확인.
2. 3단계 위저드 — jest, dev에서 새 공고 1→2→3 이동·자동 저장·잠금 공고 확인.
3. 지원서 상단 — jest/화면, 모바일 폭 확인.

- 공통: `tsc --noEmit`, lint, 관련 jest, `next build --webpack`, Playwright 스크린샷(PC·모바일 폭). develop PR → 사용자 확인 후 release cherry-pick.

## 롤백

- 코드만 revert하고 마이그레이션 파일은 남긴다. 테이블과 작성된 메시지가 보존되고, 다시 배포해도 같은 마이그레이션이라 충돌하지 않는다. #1446에서 DROP한 옛 데이터(운영 1건, 미사용)는 복구하지 않는다.
- 마감일 이동·단계 변경은 UI만 바뀌고 저장 API·데이터는 그대로.

## Codex 검토 반영

Codex 리뷰(adversarial): 지적 6건 — 반영 5, 일부 보류 1.

- 롤백 데이터 보존 → 롤백 시 마이그레이션 파일 유지, 옛 1건은 복구하지 않음 명시.
- 공개 헤더 테넌트 경계 → 거른 positions·stores만 사용, 다른 Space 관계가 섞인 fixture 테스트.
- 예시 추가 동시 요청 → advisory lock.
- 메일 설정 회귀 → `PostingMailSettings`는 2단계에 유지, 잠긴 공고 회귀 테스트.
- 마감일 저장 실패 경로 → 과거 날짜·저장 실패 시 이동 막힘 테스트.
- SMS 플랫폼 호환 → 번호 정규화 반영. 실기기 확인은 iPhone 미러링으로 문자 앱이 열리고 받는 사람·한글·줄바꿈 본문이 채워지는지까지만 확인(발송 안 함). Android 실기기가 없어 `?&body=` 형식(양쪽 공용 관례)에 기대고 복사 대안으로 보완 — 보류.
