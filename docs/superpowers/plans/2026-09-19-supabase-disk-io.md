# Supabase Disk I/O 절감 Implementation Plan

> **For Hermes:** Implement this plan task-by-task with focused Jest checks before each behavior change.

**Goal:** `AdRecord` 전체 스캔·디스크 정렬과 워커의 불필요한 반복 DB 요청을 줄여 Supabase Disk I/O budget 소모를 낮춘다.

**Architecture:** `origin/main`에 이미 반영된 campaign catalog query는 기존 `(workspaceId, campaignId, adType, date ASC)` 인덱스를 index-only scan으로 사용하고, 외부 디스크 정렬을 제거한다. 기간 범위 집계는 workspace cache로 재사용한다. worker heartbeat만 2분으로 낮춘다.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, PostgreSQL, Jest

---

### Task 1: 캠페인 날짜 범위 cache 회귀를 막는다

**Files:**
- Test: `src/lib/coupang-ads/__tests__/queries.test.ts`

1. 두 번의 동일 workspace 조회에서 `campaign-date-ranges` loader가 한 번만 실행되고 `AdRecord.groupBy()`도 한 번만 실행되는 failing test를 작성한다.
2. 테스트를 통과시킨다.

### Task 2: worker heartbeat write 빈도를 낮춘다

**Files:**
- Modify: `worker/src/heartbeat.ts`
- Test: `worker/src/__tests__/heartbeat.test.ts`

1. heartbeat 기본 간격이 120초라는 failing test를 작성한다.
2. heartbeat interval을 120초로 변경한다.
3. 테스트를 통과시킨다.

활성 수집 스케줄 조회는 매분 정확히 cron 일치를 판정해야 한다. 2분 cache는 새로 저장된 다음 분 스케줄을 누락할 수 있으므로 추가하지 않는다.

### Task 3: production query plan을 직접 확인한다

1. production read-only `EXPLAIN (ANALYZE, BUFFERS)`로 catalog query가 기존 `(workspaceId, campaignId, adType, date ASC)` 인덱스를 사용하는지 확인한다.
2. index-only scan과 disk external sort 부재를 확인한다.
3. 새 DESC 인덱스는 기존 query plan에서 이점이 없어 추가하지 않는다.
