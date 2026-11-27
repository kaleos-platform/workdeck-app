# 의견 남기기(이용자 피드백) 설계

작성: 2026-11-27 · 브랜치 `feat/user-feedback`(base develop)

## 의도

오프닝워크에서 Tally 폼(https://tally.so/r/3EKBON)으로 받던 「의견 남기기」를 워크덱 안으로 옮긴다.
워크덱 이용자가 앱 안에서 불편·오류·기능 제안을 바로 보내고, 운영자(에디)가 어드민에서 접수→처리까지 관리한다.
목적은 CS 관리와 제품 개선 의견 수집. 로그인 상태라 이메일을 다시 묻지 않고, 어느 화면에서 보냈는지 자동으로 남겨 오류 재현을 빠르게 한다.

랜딩 페이지 「문의하기」(구매의향자 채팅 문의·리드)는 **범위 밖** — 별도 작업 공간에서 진행.

## 목표

- 사이드바에서 어느 업무 화면이든 「의견 남기기」 팝업으로 의견 제출(이미지 첨부 포함).
- 접수 즉시 운영 Slack 알림.
- 어드민 「의견」 메뉴에서 목록·필터·상태 변경·내부 메모·첨부 열람.
- 첨부 저장 용량을 상태 기반 자동 삭제로 관리.

## 비목표 / 반목표

- 이용자 화면의 「내 의견」 내역·답변 표시, 상태 변경 자동 메일 — 하지 않음(Q1 결정). 답장은 운영자가 메일로 직접.
- 비로그인(랜딩) 제출 — 하지 않음.
- 반목표: 첨부가 공개 URL로 노출되는 것, 다른 작업 공간 사용자가 남의 의견을 보는 것, Slack에 첨부 원본이 올라가는 것.

## 결정 사항(에디)

| 항목 | 결정 |
|---|---|
| 회신 | 어드민 관리만. 신규 접수는 Slack 메시지로 운영자에게 발송 |
| Slack | 별도 웹훅 env `FEEDBACK_SLACK_WEBHOOK_URL`, 미설정 시 `LEAD_SLACK_WEBHOOK_URL` 대체, 둘 다 없으면 생략 |
| 입구 | 사이드바 하단 로그아웃 위 버튼 + Dialog. 접힌 사이드바는 아이콘+툴팁 |
| 유형 | 5개: 기능 제안(FEATURE) · 서비스 오류(BUG) · 문의(QUESTION) · 이용 후기(REVIEW) · 기타(OTHER) |
| 첨부 | 이미지 첨부 받음 |
| 상태 | 접수(NEW) → 확인 중(IN_PROGRESS) → 완료(DONE) / 보류(ON_HOLD) |
| 첨부 보관 | 완료 30일·보류 90일 후 첨부만 자동 삭제(본문 보존). 완료/보류에서 다른 상태로 되돌리면 삭제 예약 취소. 어드민에 총 첨부 용량·건별 삭제 예정일·건별 즉시 삭제 |

## 접근 방식

1. **워크덱 내 직접 구현(채택)** — 기존 「도입 신청」(`MarketingLead` + `/admin/leads` + `src/lib/marketing/lead-notify.ts`) 패턴과 모집 관리 Storage·정리 cron 패턴 재사용. 자동 맥락·용량 관리 모두 가능.
2. Tally 임베드 + 웹훅 수집 — 첨부가 Tally에 있어 용량 관리 불가, 맥락 수집 불안정. 기각.
3. 채널톡 등 외부 상담 도구 — 이용자 의견 관리엔 과함. 랜딩 작업에서 별도 판단. 기각.

## 설계

### 데이터 (`prisma/schema.prisma`, `migrate dev`)

```prisma
enum UserFeedbackType   { FEATURE BUG QUESTION REVIEW OTHER }
enum UserFeedbackStatus { NEW IN_PROGRESS DONE ON_HOLD }

model UserFeedback {
  id          String             @id @default(cuid())
  userId      String             // 제출자
  spaceId     String?            // 제출 당시 작업 공간(없을 수 있음)
  type        UserFeedbackType
  body        String             // 1~5000자
  pagePath    String?            // 보던 화면 pathname+search (최대 500자)
  userAgent   String?            // 최대 500자
  status      UserFeedbackStatus @default(NEW)
  memo        String?            // 운영자 내부 메모
  closedAt    DateTime?          // DONE/ON_HOLD 진입 시각, 그 외 상태로 가면 null
  attachments UserFeedbackAttachment[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([createdAt])
  @@index([status, closedAt])
}

model UserFeedbackAttachment {
  id         String   @id @default(cuid())
  feedbackId String
  feedback   UserFeedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  path       String   @unique  // Storage 객체 경로
  mimeType   String
  sizeBytes  Int
  deletedAt  DateTime?         // 파일 삭제됨(행은 이력으로 보존)
  createdAt  DateTime @default(now())
  @@index([feedbackId])
}
```

- `userId` → User FK `onDelete: Cascade` (**탈퇴 시 의견·첨부 함께 삭제**, 에디 결정 — 처리방침 「탈퇴 시 지체 없이 파기」 원칙과 일치).
- `spaceId` → Space FK `onDelete: SetNull` (작업 공간만 지워지고 사용자는 남는 경우 의견 보존).
- Cascade는 DB 행만 지운다. **Storage 파일 삭제 경로 필요**: 사용자 삭제 코드(`app/api/admin/users/[id]/route.ts`의 `tx.user.delete` 및 그 밖의 모든 사용자 삭제 경로 — 빌더가 grep으로 전수 확인)에서 삭제 전 해당 사용자의 미삭제 첨부 path를 모으고, 커밋 후 Storage remove(실패는 로그·Sentry, 탈퇴 자체는 막지 않음).

### 저장소

- Supabase Storage **비공개** 버킷 `feedback-files`(신규). 생성은 hiring 버킷처럼 **Supabase 대시보드 수동**(dev·prod 각각, public false, 파일 크기 제한 1MB, 허용 MIME png/jpeg/webp/gif). `storage.buckets` 마이그레이션은 `migrate dev` shadow DB 오류 이력이 있어 택하지 않음. 배포 체크리스트에 포함. 공개 URL 금지, 어드민 열람은 서명 URL(짧은 만료).
- 경로: `{feedbackId}/{random}.{ext}`.

### 제출 흐름

1. 사이드바 버튼 → Dialog(유형 라디오, 본문 textarea, 이미지 최대 3장, 미리보기·제거).
   안내 문구는 Tally 톤 차용: "불편한 점, 제안하고 싶은 기능, 오류를 남겨주시면 확인 후 조치하겠습니다. 자세히 적을수록 빨라요."
2. 클라이언트에서 이미지 축소(최장변 1600px, WebP 품질 0.8, 미지원 시 JPEG)해 장당 ~300~500KB로 만든 뒤 **한 번의 multipart POST** `/api/feedback`. (Vercel 함수 본문 4.5MB 한도 때문. 서명 업로드 URL 방식은 고아 파일 정리가 추가로 필요해 택하지 않음.)
3. 서버: 로그인 필수 → zod 검증(유형·본문 길이) → 파일 검증(최대 3개, 장당 ≤1MB, 매직바이트로 png/jpeg/webp/gif만) → 사용자별 rate limit(기존 `checkRateLimit`(`src/lib/hiring/applications.ts`, 분당 5·시간당 20 고정, 인스턴스별 in-memory) 재사용, 키 `feedback:{userId}` — 남용 방지 수준이면 충분) → DB 행 생성 → Storage 업로드 → 첨부 행 생성. 업로드·DB 실패 시 올린 파일 삭제 후 오류 응답.
4. `pagePath`는 클라이언트가 `location.pathname + search` 전송, `spaceId`는 서버가 현재 세션의 작업 공간에서 결정(`src/lib/api-helpers.ts`의 `resolveSpaceContext` 계열, 클라이언트 값 신뢰 안 함). 작업 공간이 없으면 404 대신 null로 저장하도록 감싼다.
5. 성공 시 토스트 "의견이 접수됐어요. 확인 후 조치할게요." 후 Dialog 닫기.
6. Slack 알림은 응답을 막지 않게 실패 무시(로그만). 내용: 유형, 제출자 이메일, 작업 공간 이름, 화면 경로, 본문 앞 300자(escape), 첨부 개수, 어드민 상세 링크. 첨부 원본·서명 URL은 넣지 않음.

### 어드민 (`app/admin/feedback`, `/api/admin/feedback/*`)

- NAV_ITEMS에 `{ href: '/admin/feedback', label: '의견' }`.
- 모든 API 첫 줄 `requireOperator()`(`src/lib/admin/auth.ts`), 상태·메모 변경·첨부 삭제는 기존 어드민 감사 로그 관례 따름.
- 목록: 접수일, 유형, 상태, 제출자(이메일), 작업 공간, 본문 요약, 첨부 수. 유형·상태 필터. 최신순.
- 상단 요약: 상태별 건수, 총 첨부 용량(삭제 안 된 첨부 sizeBytes 합).
- 상세(패널 또는 페이지): 본문 전체, 화면 경로, 브라우저, 첨부 썸네일(서명 URL), 상태 변경, 내부 메모, 제출자 메일 링크(mailto), 첨부 삭제 예정일(closedAt+30/90일), 건별 「첨부 지금 삭제」.
- 상태 변경 시 `closedAt` 갱신: DONE/ON_HOLD 진입 → now, 그 외 → null(삭제 예약 취소). DONE↔ON_HOLD 사이 이동은 now로 재설정.

### 첨부 자동 정리 cron

- `/api/cron/feedback-attachment-cleanup`, `withCronRun` 래퍼(기존 hiring 정리와 같은 방식), `vercel.json`에 하루 1회.
- 대상: `deletedAt IS NULL` 이고 (status=DONE AND closedAt ≤ now-30d) 또는 (status=ON_HOLD AND closedAt ≤ now-90d).
- Storage remove 성공한 경로만 `deletedAt` 기록. 실패는 다음 실행에서 재시도.

### 개인정보처리방침

`app/(marketing)/privacy/page.tsx` 수집 항목에 「의견 남기기: 의견 내용, 첨부 이미지, 이용 화면 주소, 브라우저 정보 / 목적: 문의 응대·서비스 개선 / 보관: 회원 탈퇴 시 파기, 첨부는 처리 완료 30일(보류 90일) 후 파기」를 추가한다. 기존 문구 형식·개정일 표기 관례를 따른다.

### 범위 밖(확정)

- Tally 기존 응답 이전 — 하지 않음(새로 받는 것만).

### Supabase 비용 가드 (에디 요구: 비용 증가 없음)

운영은 Supabase Pro(조직 단위 포함량: Storage 100GB, 비캐시 egress 250GB, DB 디스크 8GB/프로젝트). 초과분만 과금(Storage ≈$0.021/GB·월, egress $0.09/GB). 의견 기능이 이 포함량을 의미 있게 소비하지 않도록:

1. **총 용량 상한**: 미삭제 첨부 sizeBytes 합이 `FEEDBACK_STORAGE_CAP_MB`(기본 500) 이상이면 서버가 첨부를 거부하고 본문만 접수(Dialog에 "지금은 이미지를 받을 수 없어요" 안내). Slack 알림에 "첨부 용량 상한 도달" 1회 표시. 최악의 경우에도 의견 첨부 기여 ≤0.5GB.
2. **작은 파일**: 클라이언트 축소 + 서버 장당 1MB·3장 상한 + 버킷 자체 1MB 제한(이중 방어).
3. **자동 삭제**: 완료 30일·보류 90일 → 보관량은 처리 속도에 비례해 고정 수준 유지.
4. **egress 최소화**: 어드민 목록에는 이미지 미로드(첨부 수만). 상세 열 때만 서명 URL(만료 10분)로 원본 로드. **Supabase 이미지 변환(transform/render) 사용 금지** — Pro에서 원본 이미지 수 기준 별도 과금 항목.
5. **새 과금 리소스 없음**: Realtime·Edge Functions·추가 Auth 사용 없음, DB는 작은 텍스트 행. 정리 cron은 Vercel cron(하루 1회)으로 Supabase 컴퓨트 부담 없음.

예상 규모: 월 100건·건당 평균 1장·400KB 가정 시 월 ~40MB, 자동 삭제로 상시 보관 수십 MB → 포함량 대비 0.1% 미만. 배포 전 Supabase 대시보드 Usage에서 현재 조직 Storage·egress 사용량을 확인해 포함량 여유를 기록한다(운영 DB 직접 조회는 권한상 불가해 미확인).

## 제약

- develop → (develop 환경 검증) → main 2단계 릴리스.
- 스키마는 `migrate dev`만. prod 직접 SQL 금지.
- Storage 서비스 키가 필요한 서버 코드는 기존 hiring 어댑터 방식(service role) 따름.
- UI는 `workdeck-ui` 스킬 + `DESIGN.md` 준수. 사이드바 버튼은 기존 로그아웃 버튼과 같은 스타일.

## 빌더 재량

- 컴포넌트·파일 배치, 어드민 상세를 패널로 할지 페이지로 할지.
- 이미지 축소 구현(캔버스 직접 vs 이미 설치된 라이브러리) — 새 의존성 추가 금지 원칙.
- 테스트: 제출 API(검증·rate limit·권한), cron 대상 선정, 상태 변경 closedAt 규칙 각 1개 이상.
