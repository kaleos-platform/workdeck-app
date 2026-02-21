# 쿠팡 광고 리포트 매니저 개발 로드맵 v1 (Codex)

쿠팡 광고 리포트 분석 MVP를 구조 우선으로 완성해 업로드부터 인사이트 도출까지 단일 플로우를 안정화한다.

## 개요

쿠팡 광고 리포트 매니저는 쿠팡 광고를 직접 운영하는 1인 셀러/소규모 쇼핑몰 운영자를 위한 데이터 분석 도구로, 다음 핵심 기능을 제공한다.

- **리포트 업로드 및 정규화**: `.xlsx` 파일을 검증/파싱/정규화하여 저장하고 중복 없이 누적한다.
- **캠페인 성과 분석**: 시계열 지표, 원시 데이터 테이블, 비효율 키워드 분석을 공통 필터로 조회한다.
- **운영 이력 관리**: 캠페인별 일자 메모를 저장해 광고 작업 맥락을 추적한다.

## 개발 워크플로우

1. **작업 계획**

- 현재 코드베이스(라우트/UI 골격/Prisma 스키마/미들웨어) 상태를 기준선으로 유지한다.
- 본 로드맵을 단일 우선순위 기준으로 사용하고, 변경 시 Task 순서와 의존성을 함께 갱신한다.
- 신규 Task는 마지막 번호 다음으로 추가한다.

2. **작업 생성**

- `/tasks` 디렉토리를 생성하고 `XXX-description.md` 형식으로 작업 문서를 작성한다.
- 각 작업 문서에는 목표, 관련 파일, 구현 단계, 수락 기준을 포함한다.
- API/비즈니스 로직 작업 문서에는 `## 테스트 체크리스트`와 Playwright MCP 시나리오를 필수로 작성한다.

3. **작업 구현**

- Task 순서대로 구현하되, 병렬 가능한 UI/API 작업은 분리 진행한다.
- API 연동 및 비즈니스 로직 구현 시 Playwright MCP 기반 통합/E2E 검증을 반드시 수행한다.
- 단계 완료 시 작업 문서 체크리스트를 갱신하고 결과를 기록한다.

4. **로드맵 업데이트**

- 완료된 Task는 `✅ - 완료`로 표시하고, 작업 문서 경로를 연결한다.
- 완료된 Phase는 제목에 `✅`를 추가한다.

## 개발 단계

### Phase 1: 애플리케이션 골격 구축 ✅

- **Task 001: 라우트/레이아웃 골격 구성** ✅ - 완료
  - See: `app/layout.tsx`, `app/dashboard/layout.tsx`, `app/(auth)/layout.tsx`
  - ✅ App Router 기반 라우트 그룹/레이아웃 구성
  - ✅ 인증/대시보드/마케팅 영역 진입점 페이지 생성
  - ✅ 공통 헤더/사이드바 골격 반영

- **Task 002: 인증 기반 접근 제어 골격 구축** ✅ - 완료
  - See: `middleware.ts`, `src/lib/supabase/middleware.ts`, `app/dashboard/layout.tsx`
  - ✅ 보호 라우트/비로그인 전용 라우트 리다이렉트 구성
  - ✅ Supabase SSR 세션 갱신 미들웨어 연동
  - ✅ 로그인/회원가입 기본 폼 연결
  - ✅ 워크스페이스 미생성 사용자 → /workspace-setup 리다이렉트 구현

- **Task 003: 데이터 모델 초안 및 타입 기반 정렬** ✅ - 완료
  - See: `prisma/schema.prisma`, `src/lib/prisma.ts`
  - ✅ `Workspace`, `ReportUpload`, `AdRecord`, `DailyMemo` 스키마 정의
  - ✅ 1인 1워크스페이스 제약(`ownerId @unique`) 반영
  - ✅ 메모 유니크 키(`workspaceId`, `campaignId`, `date`) 반영
  - ✅ AdRecord 누락 필드 추가: adGroup, placement, productName, optionId
  - ✅ 업서트 복합 유니크 인덱스 추가
  - ✅ User.id를 Supabase Auth UUID와 정합성 맞춤
  - ✅ Prisma 클라이언트 싱글톤 생성

### Phase 2: UI/UX 완성 (더미 데이터 활용) ✅

- **Task 004: shadcn/ui 컴포넌트 및 더미 데이터/타입 기반 구축** ✅ - 완료
  - See: `src/components/ui/`, `src/types/index.ts`, `src/lib/dummy-data.ts`
  - ✅ shadcn/ui 컴포넌트 15종 설치 (button, card, input, select, table, tabs, form, avatar, dropdown-menu, separator, label, checkbox, textarea, badge, progress)
  - ✅ TypeScript 타입 정의 7종 생성 (`src/types/index.ts`)
  - ✅ 더미 데이터 모듈 생성 (DUMMY_CAMPAIGNS, DUMMY_METRIC_SERIES, DUMMY_AD_RECORDS, DUMMY_KEYWORDS, DUMMY_MEMOS, DUMMY_KPI, DUMMY_UPLOAD_HISTORY)

- **Task 005: URL 기반 공통 필터 및 캠페인 상세 UI 완성** ✅ - 완료
  - See: `src/components/dashboard/filter-bar.tsx`, `app/dashboard/campaigns/[campaignId]/page.tsx`
  - ✅ FilterBar 컴포넌트 구현 (useSearchParams/useRouter 활용, from/to/adType URL 파라미터 동기화)
  - ✅ 캠페인 상세 페이지 리팩토링 (CampaignChart, FilterBar, DailyMemo 연결)
  - ✅ 광고 데이터 탭 정렬/페이지네이션 구현
  - ✅ 키워드 분석 탭 체크박스 선택/복사 기능 구현

- **Task 006: 대시보드 UI 및 메모 컴포넌트 완성** ✅ - 완료
  - See: `src/components/dashboard/daily-memo.tsx`, `app/dashboard/page.tsx`
  - ✅ DailyMemo 컴포넌트 생성 (날짜 선택, 메모 생성/수정/삭제 UI)
  - ✅ 대시보드 페이지 업데이트 (KPI 카드, 캠페인 목록, 업로드 이력 표시)
  - ✅ 더미 데이터 기반 전체 UI 플로우 동작 확인

### Phase 3: 핵심 기능 구현 - 우선순위

- **Task 007: 업로드 API 및 Excel 파싱 파이프라인 구현** - 우선순위
  - `POST /api/reports/upload` 구현(확장자 검증, 파싱, 저장, 결과 반환)
  - SheetJS 기반 컬럼 매핑/정규화(`YYYYMMDD`, `%`, 과학표기, 결측값) 구현
  - 업서트 키(`workspaceId+date+campaignId+adType+keyword+adGroup+optionId`) 기반 idempotent 저장
  - `ReportUpload` 감사 로그와 `inserted/updated/skipped/errors` 응답 계약 고정
  - Playwright MCP로 업로드 성공/실패/재업로드 시나리오 검증

- **Task 008: 워크스페이스 생성 및 소유권 API 구현**
  - `POST /api/workspace` 구현 및 1인 1워크스페이스 충돌(`409`) 처리
  - 대시보드 접근 시 워크스페이스 미생성 사용자 리다이렉트 로직 완성
  - workspace 소유권 검증 유틸을 공통 서버 레이어로 분리
  - 권한 오류 표준 에러(`401/403`) 응답 형태 통일
  - Playwright MCP로 가입→워크스페이스 생성→대시보드 진입 검증

- **Task 009: 캠페인/지표 조회 API 구현**
  - `GET /api/campaigns`, `GET /api/campaigns/:campaignId/metrics` 구현
  - 기간/광고유형 필터 조건에 따른 집계 쿼리 작성
  - 시계열 응답(`series[]`) 정렬/빈 데이터 처리 표준화
  - UI 차트(F002)와 API 계약 정합성 검증
  - Playwright MCP로 필터 변경 시 차트 갱신 시나리오 검증

- **Task 010: 광고 데이터/키워드 분석 API 구현**
  - `GET /api/campaigns/:campaignId/records` 페이징/정렬 처리
  - `GET /api/campaigns/:campaignId/inefficient-keywords` 조건 필터 처리
  - `keyword NOT IN ('-', '', null)` 정규화 결과와 조회 조건 일치 보장
  - UI 테이블(F004)/키워드 복사(F003)와 데이터 연결
  - Playwright MCP로 테이블 정렬/페이지 크기/키워드 복사 검증

- **Task 011: 일자별 메모 API 구현**
  - `POST /api/campaigns/:campaignId/memos` upsert 구현
  - `DELETE /api/campaigns/:campaignId/memos` 구현 및 재조회 일관성 보장
  - 메모 조회 API(캠페인/기간 기반) 추가 또는 기존 조회 API에 포함 결정
  - 유니크 키 충돌/권한 오류/유효성 오류 처리 표준화
  - Playwright MCP로 메모 CRUD E2E 검증

- **Task 012: API 통합 테스트 및 계약 안정화**
  - 단위: 정규화 함수(날짜/퍼센트/결측/과학표기) 테스트
  - 통합: 업로드 idempotency, 필터 조합 조회 정확성 검증
  - 에러 응답 포맷 공통화(`code`, `message`, `details`) 적용
  - 성능 기준(50k행 60초 목표) 측정 스크립트와 결과 기록
  - Playwright MCP로 핵심 사용자 여정 전체 회귀 테스트 수행

### Phase 4: 품질 강화 및 운영 안정화

- **Task 013: 비기능 요구사항 강화**
  - `Asia/Seoul` 시간대 일관성 점검(파싱, 저장, 조회, 렌더링)
  - 대용량 업로드 시 타임아웃/에러 복구 전략 보강
  - 네트워크 실패 시 재시도 UX/메시지 표준화
  - 감사 로그 조회(업로드 이력) 신뢰성 검증

- **Task 014: 배포/운영 체크리스트 정리**
  - 환경 변수/배포 설정 검증(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`)
  - 운영 전 최종 E2E 스모크 테스트 시나리오 문서화
  - 장애 대응 가이드(업로드 실패/권한 오류/데이터 누락) 작성
  - MVP 릴리스 기준선과 제외 범위 재확인

## 수락 기준 (로드맵 완료 기준)

- PRD의 MVP 기능(F001~F007, F010, F011)이 모두 API/화면/데이터 모델 레벨에서 연결된다.
- 업로드 재실행 시 데이터 중복이 증가하지 않고, 업서트 정책이 유지된다.
- 공통 필터(`from`, `to`, `adType`)가 3개 탭에서 동일하게 동작한다.
- Playwright MCP 기반 핵심 E2E 플로우가 모두 통과한다.
