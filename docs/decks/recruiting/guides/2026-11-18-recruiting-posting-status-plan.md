# 공고 상태 정리(모집중·마감·상시 모집) + 공고 목록 hover

2026-11-18 사용자 요청.

## 요청

1. 공고 관리 표: 행 hover 배경이 [제목] 칸에서도 바뀌게, 제목 밑줄 제거.
2. 「발행됨」 → 「모집중」.
3. 「모집중」과 「접수 마감」이 동시에 보이면 안 된다. 마감일이 지나면 「마감」.
4. 마감일이 없으면 「상시 모집」. 상시 모집은 빈 날짜가 아니라 **명시적으로** 「상시 모집」을 눌러 선택하고, 그러면 날짜 입력이 비활성화된다.

## 설계

### 상태 = 저장 상태 + 마감일로 계산 (DB 상태는 그대로)

- `src/lib/hiring/posting-status.ts` 신규: `getPostingDisplayStatus(status, closingDate, now)` → `DRAFT | OPEN | CLOSED | ARCHIVED`.
  - `ACTIVE` + 마감일 지남(`isHiringDeadlinePassed`) → `CLOSED`, 그 외 `ACTIVE` → `OPEN`.
  - 상태 라벨: 작성 중 / **모집중** / 마감 / 보관. `STATUS_LABELS.ACTIVE`도 「모집중」.
- 배치 작업으로 DB `status`를 CLOSED로 바꾸지 않는다(cron 없음). 이유: 이미 접수 차단·홈 「모집 중」이 같은 계산(`isHiringDeadlinePassed`, `home-summary`)을 쓰고 있고, 마감일 연장(`extend`)이 ACTIVE/CLOSED 둘 다 다루므로 계산 상태가 가장 작은 변경이다.
- `PostingStatusBadge`에 `closingDate` prop(선택)을 받아 계산 상태로 표시. 사용처(목록·상세·편집기 헤더·새 공고 복사 목록·미리보기) 모두 전달.
- 공고 목록 「접수 마감」 보조 문구 제거(배지 하나만). 상세 화면 「접수 마감 · …」 문구는 「마감 · 현재 지원서를 받지 않습니다.」.
- 상태 탭 필터(`src/lib/hiring/posting-list.ts`): 탭 이름 「발행됨」→「모집중」.
  - 모집중: `status=ACTIVE AND (closingDate IS NULL OR closingDate >= 오늘 KST 00:00Z)` — `home-summary`와 같은 조건을 공용 함수(`openPostingWhere`)로 뽑아 둘 다 사용.
  - 마감: `status=CLOSED OR (status=ACTIVE AND closingDate < 오늘)`.
  - 안내 문구 「상태 탭은 발행 상태 기준…」 제거/수정.
- 「지원서 링크 복사」 메뉴 노출 조건은 계산 상태 OPEN 기준(기존과 동일 의미).
- MCP 도구 설명의 「ACTIVE(발행됨)」 문구 → 「ACTIVE(모집중, 마감일 지나면 마감으로 표시)」.

### 상시 모집 명시 선택

- 저장 값은 그대로: `closingDate = null` ↔ 상시 모집. 새 초안은 이미 기본 마감일(오늘+14)이 있어 null은 사용자가 고른 경우만 생긴다.
- UI: 마감일 입력 옆 체크박스(또는 스위치) 「상시 모집」. 켜면 날짜 입력 `disabled` + 값 비움 + 「마감일 없이 직접 마감할 때까지 지원서를 받습니다」 안내. 끄면 날짜 입력 활성화, 마감일 필수.
  - 위저드 1단계(`step-form-settings.tsx`): 체크 해제 + 날짜 비어 있음 → 저장/다음 단계 막고 「마감일을 선택하거나 상시 모집을 선택하세요」. 「비워두면 상시 모집」 문구 제거.
  - 발행 창(`publish-dialog.tsx`): 「상시 모집으로 변경」 버튼 → 같은 체크박스. 날짜도 상시도 없으면 「발행하기」 비활성.
  - 상시 모집을 끄면 직전 날짜(없으면 오늘+14) 복원.
- 서버 검증은 기존대로(null 허용, 과거 날짜 거부).

### 공고 목록 hover

- 제목 칸은 가로 스크롤용 `sticky bg-background`라 행 hover 배경을 덮는다 → 행에 `group`, 제목 칸에 불투명 hover 배경(`group-hover:` + muted를 background에 섞은 색)을 줘서 다른 칸과 같은 색으로 보이게. 제목 링크 `hover:underline` 제거(지원자 수 링크는 유지).

## 변경 파일

src/lib/hiring/posting-status.ts(+test), src/lib/hiring/posting-list.ts, src/lib/hiring/home-summary.ts, src/components/hiring-posts/(status-badge, postings-table, posting-detail, build-wizard, new-posting-button, posting-preview, step-form-settings, publish-dialog).tsx, app/d/recruiting/postings/page.tsx, src/lib/agent/tools/recruiting-tools.ts, 관련 테스트.

## 검증

- jest: 계산 상태(마감일 오늘·어제·없음, KST 경계), 탭 필터 where, 배지 라벨, 상시 모집 체크 시 입력 비활성·null 저장·해제 시 날짜 필수·발행 버튼 비활성, 목록 「접수 마감」 미표시.
- dev 화면: 공고 목록 hover(제목 칸 포함)·밑줄 없음, 마감 지난 ACTIVE 공고가 「마감」 탭에 있고 「모집중」 탭에 없음, 위저드·발행 창 상시 모집 토글, 모바일 폭.

## 롤백

- UI·조회 조건만 바뀌고 스키마·데이터 변경 없음 → PR revert.

## Codex 검토 반영

Codex 리뷰(adversarial): 지적 4건 — 반영 3, 보류 1.

- **복사 초안 null 마감일(반영):** 공고 복사(`/postings/[id]/copy`, `copy-posting.ts`)·템플릿으로 새 공고도 새 초안과 같은 기본 마감일(오늘+14 KST)로 만든다. 기존 null 초안은 편집기·발행 창에서 「상시 모집」 체크가 **켜진 상태로 보이게** 해서, 발행 전 사용자가 상시 모집임을 눈으로 확인하도록 한다(발행 창은 마지막 확인 단계라 여기서 끄고 날짜를 고를 수 있음). 별도 플래그 컬럼은 만들지 않는다.
- **MCP 상태 불일치(반영):** `hiring_list_postings`의 status 필터를 웹 탭과 같은 계산 조건(`openPostingWhere`/마감 조건)으로 바꾸고, 응답에 저장 상태 `status`와 함께 계산 상태 `displayStatus`(작성 중/모집중/마감/보관)를 넣는다. `hiring_get_posting`도 `displayStatus` 추가. 만료된 ACTIVE·수동 CLOSED 테스트.
- **PATCH 날짜 검증(반영):** `updatePostingSchema`의 `closingDate`를 `YYYY-MM-DD` 형식으로 검증하고, PATCH에서 **바뀐** 날짜가 KST 오늘보다 과거면 400(기존 과거 날짜를 그대로 두는 저장은 허용). 직접 API 요청 테스트.
- **발행 창 오래된 날짜(보류):** 발행 창은 발행 직전 마지막 확인 단계이고, 창에 보이는 날짜·상시 여부가 그대로 발행된다는 것이 의도된 동작이다. 다른 탭에서 동시에 마감일을 바꾼 뒤 오래된 창으로 발행하는 경우만 해당해 드물다. 대신 발행 창을 열 때 현재 저장값으로 초기화한다(기존 동작 확인).
