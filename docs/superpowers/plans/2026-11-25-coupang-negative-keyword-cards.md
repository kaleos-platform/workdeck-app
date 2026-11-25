# 쿠팡 광고 「제외 키워드」 후보 화면 — 구현 계획

- 작성: 2026-11-25, 마스터 공간 `workdeck-app-coupang-growth`
- 브랜치/worktree: `feat/coupang-negative-keyword-cards` / `workdeck-app-coupang-negkw` (origin/develop `74a71248` 기준)
- 근거 결정: `docs/superpowers/plans/2026-11-21-coupang-ads-negative-keywords.md` 「2단계 재설계 결정」 1~9 (마스터 브랜치 `docs/coupang-growth-roadmap`)
- 와이어프레임·화면 결정: `docs/design/plans/negative-keyword-cards/` (마스터 브랜치). **B안 새 메뉴 「제외 키워드」**, 표 열 = 검색어·30일 광고비·클릭·14일 주문·마지막 지출일.

## 목표

쿠팡 광고센터에 넣을 제외 키워드 후보를 **코드 규칙**으로 캠페인별로 보여 주고, 선택 → 「제거 후 복사」 한 번으로 클립보드 복사 + 워크덱 제거 기록을 남긴다. 제거 표시 후에도 광고비가 나가는 키워드(광고센터 미등록 의심)를 맨 위에 경고한다. AI 분석은 키워드 제거 제안을 더 이상 보여 주지 않는다.

## 후보 규칙 (서버 상수, 모든 작업 공간 공통)

`src/lib/coupang-ads/negative-keyword-rules.ts`

- `WINDOW_DAYS = 30`, `MIN_AD_COST = 10_000`, `MIN_CLICKS = 10`, `PROTECT_DAYS = 90`, `SPENDING_AFTER_REMOVAL_GRACE_DAYS = 2`, `DISMISS_DAYS = 30`
- 주문 = `COALESCE(orders14d, orders1d)` (주간 분석 `data-builder.ts`와 같은 기준). `keyword IS NOT NULL`, 캠페인·검색어 단위 합산(adType·adGroup·optionId 합침).
- **후보:** 30일 광고비 합 ≥ 1만 원 AND 클릭 합 ≥ 10 AND 30일 주문 합 = 0 AND 90일 주문 합 = 0 AND 제거 표시 없음(`removedAt IS NULL`) AND 「제외 안 함」 기간 아님(`dismissedUntil IS NULL OR < now`).
- **보호(숨김·개수만):** 30일 조건(광고비·클릭·30일 주문 0)은 맞지만 90일 주문 > 0. 펼치면 90일 주문·매출·ROAS.
- **제거했는데 지출 중:** `removedAt IS NOT NULL` 이고 `date > removedAt(KST 날짜) + 2일` 인 AdRecord 의 adCost 합 > 0. 마지막 지출일·그 날 금액·제거일 표시. 캠페인 무관 전체 목록.
- 날짜는 KST 반열린 구간. `end = 오늘 00:00 KST`(오늘 제외), `start30 = end - 30일`, `start90 = end - 90일`, 조건 `date >= start AND date < end`(timestamptz 파라미터, 기존 `T00:00:00+09:00` 패턴과 같은 해석).
- 제거 후 지출: `removedDay = (removedAt AT TIME ZONE 'Asia/Seoul')::date`, 지출일 `(date AT TIME ZONE 'Asia/Seoul')::date >= removedDay + 3` 이고 adCost > 0 이면 경고(제거 당일·다음날·다다음날 지출은 유예).
- 최근 14일의 `orders14d` 는 아직 확정 전이다. 90일 보호가 있어 오판 위험이 낮으므로 별도 처리 안 함(화면 기준 줄에 「최근 14일 주문은 확정 전」 표기).

## 변경 파일과 단계

### 1. 스키마 (마이그레이션 1개)

- `prisma/schema.prisma` `KeywordStatus`에 `dismissedUntil DateTime?` 추가.
- `npx prisma migrate dev --name keyword_status_dismissed_until` (db push 금지).
- 기존 소비처는 모두 `removedAt` 으로 판정한다(`data-builder.ts:306`, `queries.ts:463`, 캠페인 화면). `removedAt=null`·`dismissedUntil` 만 있는 행이 생겨도 영향 없음을 확인했다.

### 2. 규칙·조회 (서버)

- `src/lib/coupang-ads/negative-keyword-rules.ts`: 상수 + 순수 함수 `classifyKeywords(rows, statuses, now)` → `{ campaigns: [{campaignId, campaignName, candidates[], protected[], removedCount}], spendingAfterRemoval[] }`. 입력은 SQL 집계 결과(30일·90일 합을 한 번에).
- `src/lib/coupang-ads/negative-keyword-candidates.ts`: `prisma.$queryRaw`(태그드 템플릿, 파라미터 바인딩) 1회로 90일 창의 캠페인×검색어 집계(`SUM ... FILTER (WHERE date >= 30일 시작)`로 30일 합 동시 계산). 인덱스 `[workspaceId, date]` 사용. + `keywordStatus.findMany({workspaceId})` + 제거 후 지출 집계 1회. 캠페인 이름은 AdRecord 최신 `campaignName`.
- `app/api/coupang-ads/negative-keyword-candidates/route.ts` GET: `resolveWorkspace()` 읽기 권한, 응답에 기준 상수 포함.

### 3. 쓰기 API (새 라우트, 원자적)

`app/api/coupang-ads/negative-keywords/route.ts` — `resolveWorkspace({write:true})`, campaignId 는 해당 작업 공간 AdRecord 에 있는지 확인, 키워드 1~1000개 문자열 검증.

- `POST {action:'remove', campaignId, keywords}`: **`prisma.$transaction`** 안에서 `createMany(skipDuplicates)` + `updateMany({where:{removedAt:null}, data:{removedAt: now, removedMemo:'제외 키워드 화면에서 제거'}})`. 이미 제거된 키워드는 **최초 removedAt 유지**(재시도로 유예기간 연장 안 됨). 응답 `{removedAt: now}`.
- `POST {action:'undo', campaignId, keywords, removedAt}`: `updateMany({where:{..., removedAt: <응답 받은 값>}, data:{removedAt:null, removedMemo:null}})` — 그 사이 다른 사람이 다시 제거한 행(다른 removedAt)은 건드리지 않음. 응답 `{count}`; count < 요청 수면 토스트에 「일부는 다른 사람이 다시 제거해 되돌리지 않음」.
- `POST {action:'dismiss'|'undismiss', campaignId, keywords}`: 트랜잭션 upsert `dismissedUntil = now + 30일 | null`.
- 기존 `keyword-status` DELETE(캠페인 화면 제거 취소)는 `deleteMany` → `updateMany({removedAt:null, removedMemo:null})` 로 바꿔 「제외 안 함」 기록을 지우지 않게 한다. 소비처는 모두 removedAt 만 본다.
- 구독 만료 쓰기 차단 가드(memory `project_deck_write_guard`)를 기존 쓰기 라우트와 같은 방식으로 적용.

### 4. 화면 (B안)

- `src/lib/deck-routes.ts`: `COUPANG_ADS_NEGATIVE_KEYWORDS_PATH = ${BASE}/negative-keywords`.
- `src/components/layout/sidebar.tsx` `COUPANG_MAIN_ROUTES`: 「광고 분석」 다음에 「제외 키워드」(lucide `ListX` 등).
- `app/d/coupang-ads/negative-keywords/page.tsx` + `src/components/coupang-ads/negative-keywords/*`:
  - 상단 기준 한 줄(②), 「제거했는데 지출 중 N개」 Alert + 펼치기(①, 0개면 숨김).
  - 캠페인별 Card(④): 체크박스 Table(검색어·30일 광고비·클릭·14일 주문·마지막 지출일), 전체 선택, 「제외 안 함」(⑦), 「제거 후 복사 (N개 선택)」(③), 「90일 주문 있어 제외 N개」 Collapsible(⑤, 선택 불가), 헤더에 「워크덱에서 제거한 키워드 N개」. 후보 0인 캠페인은 접힌 한 줄.
  - 「제거 후 복사」: **클릭 핸들러에서 먼저 `navigator.clipboard.writeText(keywords.join(','))`**(사용자 제스처 안), 성공 시 `remove` POST → 목록에서 제거 → sonner 토스트(⑧) 「캠페인 X — N개 제거 표시, 클립보드에 복사됨」 + action 「되돌리기」(`undo` + 응답 removedAt). 복사 실패 시 POST 하지 않고 오류 토스트. POST 실패 시 트랜잭션이라 기록은 0건 — 「복사는 됐지만 제거 기록 실패, 다시 눌러 주세요」 오류 토스트(재시도해도 최초 시각 유지).
  - 한 번에 한 캠페인만 선택 가능(다른 카드 선택 시 이전 선택 해제).
  - 빈 상태: 「지금 제외할 키워드가 없습니다」 + 기준 안내. 로딩·오류 상태.
  - 구현은 `workdeck-ui` 스킬 + `DESIGN.md` 준수. 모바일은 표 → 세로 목록으로만 접음.

### 5. AI 제안에서 키워드 제거 빼기

- `app/d/coupang-ads/analysis/page.tsx` 에서 `CampaignSuggestions` 로 넘기기 전 `type !== 'REMOVE_KEYWORD'` 필터 + 「키워드 제외는 『제외 키워드』 화면에서」 링크 한 줄. 테스트 `campaign-suggestions.rtl.test.tsx` 갱신.
- 프롬프트(`src/lib/ai/prompts.ts:15, :90`)는 이번에 바꾸지 않는다. 이유: 과거 리포트와 에이전트 도구가 같은 타입을 쓰고, 화면 필터만으로 사용자에게는 사라진다. AI가 제안 슬롯을 낭비하는 문제는 3차에서 프롬프트 정리.

### 6. Slack 분석 메시지 요약 (같은 PR 의 두 번째 커밋, 워커 배포 필요)

- complete API 는 **바꾸지 않는다**(완료 저장 응답에 무거운 집계를 붙이지 않음).
- 새 워커 전용 GET `app/api/worker/coupang-ads/negative-keyword-summary?workspaceId=` (기존 워커 인증 헬퍼 사용) → `{ candidateCount, campaignCount, spendingAfterRemovalCount }` (2단계 함수 재사용).
- `worker/src/analysis-poller.ts`: complete 성공 뒤 위 GET 을 **타임아웃 10초**로 호출, 실패·404·타임아웃이면 `undefined` 로 두고 `maybeNotifyAnalysisDone` 에 `negativeKeywordSummary` 인자로 전달(응답 타입 추가).
- `worker/src/slack-notifier.ts notifyAnalysisDone`: `topSuggestions` 에서 REMOVE_KEYWORD 제외, 요약이 있으면 「제외 후보 N개(캠페인 M개) · 제거했는데 지출 중 K개 → <제외 키워드 화면 링크>」 한 줄, 없으면 생략.
- 배포 순서: 앱 먼저. 워커가 먼저 나가도 404 → 요약 생략이라 알림은 그대로 간다.

## 범위 밖

- MCP `ads_get_inefficient_keywords`·Slack `비효율` 명령의 1일 주문 기준(별도 정정 작업).
- 광고센터 실제 등록 개수(500 상한) 조회 — 읽을 수단 없음, 「워크덱에서 제거한 키워드 N개」로 대체.
- 프롬프트의 REMOVE_KEYWORD 제거, 에밀리 지시문 문구 불일치.

## 검증

- DB 통합(jest, dev DB, memory `reference_prisma7_jest_integration`): 실제 AdRecord 저장 형식으로 KST 자정 전후 행, 30·90일 창 첫날·마지막 날, 오늘 행 제외, 제거 당일~+2일 지출(경고 아님)·+3일 지출(경고), 제거 시각 KST 23:59 / 00:01 경계.
- API 통합: remove 트랜잭션 — 중간 실패 시 0건, 재시도 시 최초 removedAt 유지; undo 가 다른 removedAt(재제거된 행)을 건드리지 않음; 기존 DELETE 가 dismissedUntil 보존; 검증 400(빈 배열·1001개·비문자열·다른 공간 캠페인).
- 성능: dev DB 와 운영 DB(읽기 전용 트랜잭션, 에디 승인 범위)에서 두 집계 쿼리 `EXPLAIN ANALYZE` — AML 공간 기준 1초 이내 목표, 넘으면 인덱스(`[workspaceId, date]` 외) 검토.
- 단위(jest): `classifyKeywords` — 경계값(9,999원/10,000원, 클릭 9/10), orders14d null → orders1d 폴백, 90일 주문 → 보호, removedAt → 후보 제외, dismissedUntil 미래/과거, 제거 후 2일 이내 지출은 경고 아님·3일째 지출은 경고.
- 화면: RTL — 한 캠페인만 선택, 복사 실패 시 POST 미호출, 보호 행 선택 불가.
- 워커: poller 가 요약 GET 성공/404/타임아웃 각각에서 notify 인자를 올바르게 넘기는지(fetch mock), `notifyAnalysisDone` 요약 줄 유무, REMOVE_KEYWORD 제외. `tsc --noEmit`, jest.
- `npm run lint`, `npm run build`, 라이브 작업대 + ego 자가 확인(데스크톱·390px, axe).
- 운영 반영 후: AML 공간에서 화면 후보가 계획 문서 1단계 결과(등록 3개는 후보에서 빠짐, 보호 7개는 보호 목록)와 맞는지 대조(읽기만).

## 롤백

- 화면·API: PR revert. 메뉴 항목 제거로 즉시 숨김 가능.
- 마이그레이션: 칼럼 추가(nullable)만이라 revert 시 칼럼은 남겨도 무해. 필요하면 후속 마이그레이션으로 drop.
- 앱 revert 시 기존 DELETE 가 다시 행을 지우므로, 캠페인 화면에서 제거 취소한 키워드의 「제외 안 함」 기록이 사라질 수 있다. 결과는 그 키워드가 30일 전에 후보로 다시 보이는 것뿐(광고·제거 기록 영향 없음)이라 감수한다.
- 워커: 요약 필드 없으면 생략하므로 앱만 revert 해도 안전. 워커 revert 후 `launchctl kickstart -k gui/$(id -u)/ai.workdeck.coupang-worker`.

## 배포

develop PR → release 브랜치 cherry-pick → main. 워커는 운영 체크아웃 `workdeck-runner` 갱신 + kickstart.

## Codex 적대 검토 (2026-11-25) — 지적 6건: 반영 5, 일부 보류 1

1. [high] 기존 POST 부분 저장 → 반영: 새 라우트 트랜잭션 + 최초 removedAt 유지.
2. [high] 되돌리기가 다른 사람의 재제거를 취소 → 반영: undo 가 응답 removedAt 과 일치하는 행만 갱신.
3. [high] 롤백 시 DELETE 가 제외 안 함 기록 삭제 → 일부 보류: DELETE 는 updateMany 로 바꾸되, revert 시 손실은 「후보 조기 재노출」뿐이라 별도 테이블은 만들지 않음(롤백 절에 명시).
4. [high] complete API 동기 집계로 완료 응답 유실 → 반영: complete 미변경, 워커가 별도 요약 GET(타임아웃 10초, 실패 시 생략).
5. [medium] poller 전달 단계 누락 → 반영: 6절에 poller 변경·테스트 추가.
6. [medium] KST 경계·SQL 검증 부재 → 반영: 반열린 구간·제거일 변환식 명시, DB 통합 테스트·EXPLAIN ANALYZE 추가.
