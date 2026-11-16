# 자주 쓰는 메시지 UI/UX 개선 — 기본 예시 자동 추가 · 변수 칩 편집기

2026-11-16 grill 확정. 대상 화면: 설정 > 메시지 관리(`/d/recruiting/settings/messages`).

## 결정

| 항목          | 결정                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 예시 메시지   | 공간마다 **처음 한 번** 자동 추가(버튼 없음). 이후 수정·삭제 자유, 전부 지워도 다시 생기지 않음. 이미 메시지가 있는 공간은 추가하지 않음 |
| 변수 입력     | 입력란 위 「이름」「공고명」「직무」 칩 → 누르면 커서 위치에 삽입                                                                        |
| 입력란 표시   | 변수는 입력란 안에서 **한 덩어리 칩**(atom)으로 표시·삭제. 직접 `{이름}`을 타이핑/붙여넣어도 칩으로 바뀜                                 |
| 저장 형식     | 지금과 같은 평문 `{이름}` `{공고명}` `{직무}` — 기존 데이터·`fillMessage`·문자 보내기와 호환                                             |
| 목록 미리보기 | 카드 본문의 변수도 같은 칩 모양으로 표시                                                                                                 |

## 1. 처음 한 번 자동 추가

- **스키마:** `HiringMessageSeed { spaceId String @id, seededAt DateTime @default(now()), space Space @relation(onDelete: Cascade) }` 새 테이블 + `ENABLE ROW LEVEL SECURITY` 마이그레이션.
- **시점:** `GET /api/hiring-applicants/message-templates`(메시지 관리·문자 보내기·상태 알림이 모두 이 API로 목록을 읽음).
  - 빠른 경로: seed 행이 있으면 바로 목록 반환(쿼리 1회 추가).
  - 없으면 트랜잭션: `pg_advisory_xact_lock(hashtext('hiring-msg-samples:'||spaceId))` → seed 행 재확인 → seed 행 생성 → 메시지 0개면 `SAMPLE_MESSAGES` 3개 생성. 동시 요청은 lock으로 한 번만.
  - **쓰기 경계:** seed 전에 `resolveDeckContext`의 write 판정과 같은 조건(쓰기 역할 + `assertDeckWritable`)을 통과할 때만 seed. 통과 못 하면 seed 없이 기존 목록 반환(다음 쓰기 가능 사용자의 GET에서 seed).
  - **실패 격리:** seed 트랜잭션은 try/catch — 실패 시 `console.error`(PII 없음) 후 롤백, 목록 조회는 계속.
- **일반 생성과 같은 경계:** POST 일반 생성도 같은 advisory lock을 잡고 seed 행을 upsert한 뒤 생성 → 사용자가 먼저 메시지를 만든 공간에는 예시가 끼어들지 않음.
- **POST `{samples:true}`**·빈 상태 「예시 메시지 3개 추가」 버튼 제거(빈 상태 문구는 「새 메시지」 안내만).
- 기존 공간: 이미 메시지가 있으면 seed 행만 기록하고 추가 안 함. 예전에 예시를 지워서 0개인 공간은 한 번 다시 들어감(1회, 허용).

## 2. 변수 칩 편집기

- `src/components/hiring-applicants/message-content-editor.tsx` (client): 이미 설치된 TipTap(`@tiptap/react`, starter-kit 일부: Document·Paragraph·Text·HardBreak·History)으로 단순 텍스트 편집기 + 커스텀 inline atom 노드 `messageVariable`(attr `key`: 이름|공고명|직무).
  - 평문 ↔ 문서 변환(정규 규칙): `\n` 기준으로 나눈 각 줄 = 문단 1개(빈 줄 = 빈 문단, 끝 줄바꿈 = 끝 빈 문단), 직렬화는 문단을 `\n`으로 연결. HardBreak(Shift+Enter)도 `\n`. 줄 안의 `{이름}` `{공고명}` `{직무}` ↔ 변수 노드. 순수 함수로 `src/lib/hiring/message-template.ts`에 두고 왕복 동일성 테스트(빈 줄·끝 줄바꿈·연속 토큰·알 수 없는 `{기타}`는 평문 유지).
  - **글자 수 제한:** 모든 트랜잭션에 `filterTransaction`으로 직렬화 길이(JS string length, 서버 zod와 같은 기준) > 1000이면 거부 — 붙여넣기·칩 삽입·선택 교체 공통. 999/1000 경계 테스트.
  - 입력 규칙/붙여넣기: `{이름}` 등 완성 토큰을 노드로 치환.
  - 칩 툴바: 「+ 이름」「+ 공고명」「+ 직무」 버튼 → 커서 위치 삽입 후 포커스 유지.
  - 접근성: 편집기 `role="textbox" aria-multiline aria-label="내용"`, 칩 노드는 `{이름}` 대체 텍스트를 가진 span.
  - 한글 IME 조합 중 변환이 끼어들지 않게 입력 규칙은 조합 종료 후 적용(ProseMirror 기본 동작 확인).
- `templates-manager.tsx`: 내용 Textarea → 위 편집기, 상단 안내 문구는 칩 툴바로 대체. 목록 카드 본문은 `MessagePreview`(같은 칩 모양 span 렌더, 편집기 없이 정적).
- 1000자 제한: 평문(토큰 포함) 기준 그대로, 남은 글자 수 표시.
- 문자 보내기·상태 알림 창은 이미 실제 값으로 치환된 본문을 다루므로 변경 없음.

## 변경 파일

prisma/schema.prisma, prisma/migrations/20261116xxxxxx_hiring_message_seed/, app/api/hiring-applicants/message-templates/route.ts(+test), src/lib/hiring/message-template.ts(+test), src/components/hiring-applicants/(message-content-editor.tsx, templates-manager.tsx, +tests), src/generated/prisma/\*\*

## 검증

- jest: seed 1회·동시 요청·기존 메시지 있는 공간 미추가·삭제 후 미재생성·쓰기 차단 시 생략, 평문↔문서 왕복, 편집기 칩 삽입·저장값.
- dev 화면(Playwright 실제 Chromium): 새 공간 첫 진입 시 예시 3개, 칩 삽입·백스페이스 한 번 삭제·여러 줄 한글 붙여넣기·선택 교체·undo, 모바일 폭.
- 한글 IME 조합 입력(조합 중 `{` 입력 등)은 자동화로 재현이 어려워 사용자 직접 확인 항목으로 남김.
- tsc·lint·관련 jest·CI(migration-lint·rls-lockdown).

## 롤백

- 코드 revert, 마이그레이션 파일은 남김(테이블만 남고 무해). 자동 추가된 예시는 일반 메시지라 사용자가 지울 수 있음.

## Codex 검토 반영

Codex 리뷰(adversarial): 지적 6건 — 반영 4, 일부 반영 1, 보류 1.

- GET seed 권한 경계 → 쓰기 역할 + `assertDeckWritable` 통과 시에만 seed. 반영.
- 일반 생성과의 경합 → POST 일반 생성도 같은 lock + seed 행 upsert. 반영.
- 편집기 길이·평문 보존 → 정규 직렬화 규칙 + filterTransaction 1000자 + 왕복 테스트. 반영.
- seed 실패 격리 → try/catch 후 목록 계속. 반영.
- IME·스크린리더 실기기 검증 → Playwright로 붙여넣기·삭제·undo는 확인, 한글 조합 입력은 사용자 확인으로 남김(일부 반영).
- 롤백 기간 이력 불일치 → 보류: 롤백 중 예시 추가 후 전부 삭제한 공간에서만 재배포 시 1회 재생성되는 드문 경우라 허용.
