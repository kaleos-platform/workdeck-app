# 쿠팡 광고 리포트 매니저 개발 로드맵 v3

기준일: 2026-02-23

현재 코드베이스를 기준으로 실제 완료 상태와 잔여 작업을 재정리한 로드맵이다.
Phase 3 잔여 처리 방향을 명확화하고, Phase 4로 분석 고도화·배포·운영 안정화 계획을 통합하였다.

## 개요

쿠팡 광고 리포트 매니저는 1인 셀러/소규모 운영자를 위해 다음 가치를 제공한다.

- **리포트 수집 자동화의 시작점**: `.xlsx/.csv` 업로드와 정규화 저장
- **성과 해석**: 캠페인 단위 시계열/원시데이터/비효율 키워드 분석
- **운영 기록**: 날짜별 메모 및 캠페인 메타 관리
- **진단 인사이트**: 낭비 예산 식별 및 성과 개선 액션 추천 (Phase 4)

## 개발 워크플로우

1. **작업 계획**

- PRD의 기능 ID(F001~F013)와 실제 코드 상태를 대조한다.
- 신규 작업은 본 문서의 마지막 Task 번호 다음으로 추가한다.

2. **작업 생성**

- `/tasks` 디렉토리를 생성하고 `XXX-설명.md` 문서를 작성한다.
- 각 문서에 목표, 구현 단계, 관련 파일, 검증 기준을 포함한다.

3. **작업 구현**

- 구조/데이터/API/UI/검증 순서로 진행한다.
- API 및 비즈니스 로직 작업은 최소 단위 검증(단위/통합)과 사용자 플로우 점검을 함께 수행한다.

4. **로드맵 업데이트**

- 완료된 Task는 `✅ - 완료`로 표시한다.
- 완료된 Phase는 제목에 `✅`를 추가한다.

## 개발 단계

### Phase 1: 애플리케이션 골격 구축 ✅

- **Task 001: 라우트/레이아웃 골격 구성** ✅ - 완료
  - App Router 그룹(`(marketing)`, `(auth)`, `dashboard`) 구성
  - 공통 헤더/사이드바/레이아웃 연결

- **Task 002: 인증/접근 제어 기반 구축** ✅ - 완료
  - Supabase SSR 세션 갱신(`proxy.ts`)
  - 보호 라우트/비로그인 전용 라우트 리다이렉트
  - 워크스페이스 미보유 시 `/workspace-setup` 이동

- **Task 003: Prisma 스키마/타입 기반 구축** ✅ - 완료
  - `Workspace`, `ReportUpload`, `AdRecord`, `DailyMemo`, `CampaignMeta` 모델 구성
  - 핵심 유니크/인덱스 반영

### Phase 2: UI/UX 완성 ✅

- **Task 004: 공통 UI 컴포넌트 구성** ✅ - 완료
  - shadcn/ui 컴포넌트 셋 구성
  - 인증/대시보드 공통 화면 스타일 통일

- **Task 005: 대시보드/업로드 화면 구현** ✅ - 완료
  - 대시보드 KPI 및 캠페인 목록
  - 업로드 폼/이력 카드 UI

- **Task 006: 캠페인 상세 화면 3개 탭 구현** ✅ - 완료
  - 대시보드 탭(차트/메모)
  - 키워드 분석 탭(정렬/복사)
  - 광고 데이터 탭(페이지네이션/컬럼토글/지면필터)

### Phase 3: 핵심 기능 구현 ✅

- **Task 007: 업로드 API 및 파서 구현** ✅ - 완료
  - `.xlsx/.csv` 파싱, 컬럼 검증, 저장
  - 중복 확인 후 `덮어쓰기/중복 제외 저장` 플로우

- **Task 008: 캠페인/지표/기록 API 구현** ✅ - 완료
  - campaigns/metrics/records/inefficient-keywords/memos API 구축
  - CTR/CVR/ROAS/참여율 계산 엔진 적용

- **Task 009: 캠페인 메타 관리 기능 구현** ✅ - 완료
  - 캠페인 표시명 수정(PATCH)
  - 캠페인 삭제(DELETE)

- **Task 010: 공통 필터 정합성 보완** ✅ - 완료
  - 광고유형 필터(`F007`) 정책 확정: `showAdTypeFilter={adTypes.length > 1}` 조건부 노출
  - `page.tsx`에서 캠페인의 `adTypes` 배열을 `FilterBar`에 전달하는 방식으로 구현
  - 탭 간 필터 유지 정책을 사용자 관점에서 재검증

- **Task 011: API 계약/문서 정합성 보강** ✅ - 완료
  - `errorResponse()` 헬퍼에 `extra` 파라미터 추가, 업로드 컬럼 검증 에러 헬퍼로 통일
  - `src/types/api.ts` 신규 생성: `UploadColumnError`, `UploadDuplicateConfirmation`, `UploadSuccess`, `UploadResponse` 타입 정의
  - `report-upload-form.tsx` 응답 필드 접근 타입 안전화

### Phase 4: 분석 고도화 & 배포 안정화

> **배포 준비 순서**: Task 010 → 011 → 016 → 017
> **가치 제공**: Task 015 (분석 고도화)
> **안정화**: Task 018 → 019

- **Task 015: 진단 엔진 고도화** - 최우선 가치
  - `src/lib/diagnosis-engine.ts` 신설
  - `/api/campaigns/[id]/diagnosis` 엔드포인트 구현
  - "오늘의 낭비 예산" UI 및 "성과 개선 액션 5선" 카드 표시
  - **진단 액션 판단 기준**:
    1. `STOP_KEYWORD`: `adCost > 기준치 AND orders1d = 0`인 키워드 존재 시
    2. `LOW_CTR`: 캠페인 평균 CTR의 50% 미만 구간이 3일 이상 연속 시
    3. `HIGH_ROAS`: ROAS > 300% 초과 캠페인 → 예산 증액 제안
    4. `CHECK_ROAS`: 최근 7일 ROAS가 이전 7일 대비 30% 이상 하락 시
    5. `ZERO_IMPRESSION`: 최근 3일 `impressions = 0` → 광고 상태 점검 제안
  - 기존 `inefficient-keywords` 로직(`app/api/campaigns/[campaignId]/inefficient-keywords/route.ts`) 재활용

- **Task 016: 보안 검토 및 문서화** ✅ - 완료
  - API 라우트 8개 보안 패턴 검증 (resolveWorkspace() 적용 현황 확인)
  - `resolveWorkspace()` 보안 레이어 명문화 + 테넌트 격리 메커니즘 문서화
  - `docs/guides/security.md` 작성 (인증/인가/테넌트격리/RLS/환경변수/민감정보 체크리스트)

- **Task 017: Vercel 배포 설정** ✅ - 완료
  - `vercel.json` 완성 (buildCommand: `npx prisma generate && next build`, `icn1` 서울 리전)
  - `docs/guides/deployment.md` 작성 (Supabase 프로덕션 분리, 환경변수 등록, 배포 절차, 도메인 연결, 스모크 테스트, 롤백 가이드)

- **Task 018: 테스트 체계 구축** - 안정화
  - Jest + ts-jest 단위 테스트: `metrics-calculator`, `excel-parser` 핵심 함수
  - Playwright E2E: 업로드 → 분석 플로우 1개 시나리오
  - ```bash
    # 단위 테스트
    npm install -D jest @types/jest ts-jest jest-environment-node
    # E2E 테스트
    npm install -D @playwright/test
    npx playwright install
    ```

- **Task 019: 문서 & 운영 체계** - 안정화
  - `/tasks` 디렉토리 복구 + `000-sample.md` 템플릿 작성
  - 스모크 테스트 절차 문서화: 회원가입 → 워크스페이스 설정 → 리포트 업로드 → 캠페인 분석
  - 장애 대응 가이드: 업로드 실패 / 인증 오류 / 데이터 누락 3개 시나리오

## 현재 상태 스냅샷

- **MVP 기능 구현률**: 높음 (Phase 1~3 전체 완료)
- **릴리스 준비도**: 완료 (즉시 배포 가능 — `vercel --prod` 실행만 남음)
- **주요 리스크**:
  - 자동화 테스트 부재 (Task 018에서 해소)
  - 작업 문서(`/tasks`) 운영 공백 (Task 019에서 해소)

## 다음 실행 순서 (권장)

```
배포 실행:  vercel --prod (docs/guides/deployment.md 참조)
가치 제공:  Task 015 (분석 고도화)
안정화:     Task 018 → 019
```
