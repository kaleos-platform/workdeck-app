# Architecture Rules

- scope: nextjs,supabase,ui
- priority: 90
- strength: MUST

## 1. Next.js (App Router)

- 기본: Server Component.
- "use client"는 상태/브라우저 API 필요 시에만 사용.
- 데이터 패칭은 서버에서 async/await 사용.
- App Router 규약(page/layout/loading/error/route.ts) 준수.

## 2. Supabase

- Next.js 연동 시 @supabase/ssr 사용.
- DB 타입은 생성된 TS 타입 적용.
- 민감 데이터/권한 우회 로직은 서버에서만 처리.
- RLS 적용 전제하에 설계.

## 3. UI & State

- Tailwind CSS 사용.
- 비즈니스 로직은 UI와 분리.
- 복잡 로직은 custom hook 또는 별도 모듈로 분리.

### 3.1 다중 선택 목록 표준 패턴

체크박스로 다중 선택이 가능한 목록(테이블/리스트)에서는 다음 패턴을 따른다.

- **일괄 액션 표시**: 화면 하단 floating action bar로 표시한다 (Linear/Notion 스타일).
  - 공통 컴포넌트 `@/components/ui/floating-action-bar`의 `FloatingActionBar` 사용.
  - 다크 배경 위 ghost 버튼은 `floatingActionButtonClass` / `floatingActionButtonDestructiveClass` 사용.
  - 폼 요소가 함께 들어가는 경우(예: Select로 일괄 변경, Input으로 메모 입력) 다크 배경 시인성을 위해 `floatingActionSelectTriggerClass` / `floatingActionInputClass` 사용.
  - 페이지 흐름 안에 액션 영역을 두면 스크롤 시 화면 밖으로 나가므로 금지.
- **선택 동작**: 헤더 체크박스(전체 선택 + indeterminate) + 행별 체크박스 + Shift+클릭 범위 선택을 표준으로 제공.
  - 범위 선택은 `@/lib/range-selection`의 `applyRangeSelection` 헬퍼를 재사용한다.

### 3.2 테이블 컬럼 폭 표준

`table-layout: auto`(브라우저 기본)에서 **`<td>`/`<th>` 의 `max-width` 는 무시된다.** `max-w-[...]` 로 컬럼을 제한하려는 코드는 동작하지 않으며, 거기에 딸린 `truncate` / `line-clamp` 도 함께 무효가 된다. 그 결과 긴 텍스트 컬럼이 무한히 늘어나고 나머지 컬럼은 `min-content` 까지 짓눌려 한글이 세로로 쌓인다.

- 컬럼 폭은 **`<table>` 에 `table-fixed`** 를 걸고 **첫 행 `<TableHead>` 의 `w-[Npx]`** 로 지정한다. `max-w-*` 는 쓰지 않는다.
- 가로 스크롤이 불가피한 입력 그리드는 `<table>` 에 `min-w-[Npx]` 를 함께 준다. **`min-w` 값은 선언한 컬럼 폭 합계 이상**이어야 한다 — 미만이면 컬럼이 다시 비례 압축된다.
- `truncate` 는 셀 내부 요소에 걸고, flex 컨테이너 안이면 부모에 **`min-w-0`** 을 함께 준다(flex 아이템 기본 `min-width: auto` 때문에 truncate 가 무효화됨). 잘리는 값에는 `title` 로 전체값을 남긴다.
- `Table`(`@/components/ui/table`)은 이미 내부에 `overflow-x-auto` 컨테이너를 갖는다. 바깥 래퍼에 `overflow-x-auto` 를 중복으로 두지 않는다 — sticky 가 엉뚱한 스크롤 조상에 붙는다.
- 가로 스크롤 테이블은 식별 컬럼에 `sticky left-0` + **불투명 배경**(`bg-background`)과 z-index를 준다.
- 레퍼런스: `src/components/sh/inventory/stock-status-matrix.tsx`, `src/components/finance/cashflow-view.tsx`, `src/components/sh/shipping/registration-table.tsx`.

## 4. Prisma & DB Migration

- Dev/Prod DB 는 별도 Supabase 프로젝트로 분리되어 있으며, 데이터는 절대 서로 옮겨지지 않는다. 스키마 동기화는 마이그레이션 파일로만 이뤄진다.
- 스키마 변경 시 반드시 `npx prisma migrate dev --name <작업명>` 사용 → `prisma/migrations/<timestamp>_<name>/migration.sql` 생성 + dev DB 자동 적용.
- 마이그레이션 파일은 **반드시 git에 커밋**한다. 파일 없이 스키마만 변경하면 prod 동기화가 깨진다.
- **금지**: `prisma db push` (개발/프로덕션 모두). 마이그레이션 이력이 기록되지 않아 배포 시 prod 스키마가 뒤처진다.
- **금지**: 프로덕션 DB에 직접 SQL/ALTER 실행. `_prisma_migrations` 테이블과 실제 스키마가 어긋나 이후 배포가 실패한다.
- 배포는 `vercel.json` 의 `buildCommand` 에 포함된 `npx prisma migrate deploy` 가 자동 수행한다. 수동 개입 불필요.
- 예외적으로 스키마 drift 를 복구해야 할 경우 `prisma migrate resolve --applied <migration>` 로 기록만 맞춘 뒤, 다음 변경부터 정상 워크플로로 복귀한다.
