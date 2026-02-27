# 쿠팡 광고 리포트 매니저 개발 로드맵 V3

기준일: 2026-02-27

본 문서는 ROADMAP V2(Phase 1~5 완료 기준선)와 PRD V3(F027~F032)를 통합한 독립 로드맵이다.

---

## 개요

### V2 완료 현황

| 항목                             | 상태                                          |
| -------------------------------- | --------------------------------------------- |
| Phase 1 — 애플리케이션 골격 구축 | ✅ 완료                                       |
| Phase 2 — UI/UX 완성             | ✅ 완료                                       |
| Phase 3 — 핵심 기능 구현         | ✅ 완료                                       |
| Phase 4 — 배포 안정화            | ✅ 완료                                       |
| Phase 5 — V2 UX 개선 & 기능 보강 | ✅ 완료 (Task 020~032)                        |
| Task 015 — 진단 엔진 고도화      | ⏳ 미완료 → Phase 6 이관                      |
| 프로덕션 배포                    | ✅ https://coupang-ad-manager-iota.vercel.app |

완료된 Task: 001~014, 016~032 (총 31개)

### V3 목표

PRD V3(F027~F032) 6개 기능을 구현하여 대시보드 기간 필터·예산/목표 설정·관리 지표를 추가한다.

| 그룹                     | 범위                       | Task         |
| ------------------------ | -------------------------- | ------------ |
| A — 즉시 적용            | UI/설정 수정, DB 변경 없음 | Task 033~034 |
| B — API/쿼리 수정        | 데이터 모델 변경 없음      | Task 035     |
| C — DB 마이그레이션 포함 | 높은 복잡도                | Task 036~038 |
| Phase 6                  | 분석 고도화 (V2 이관)      | Task 015     |

---

## 개발 워크플로우

1. **작업 계획**: PRD 기능 ID(F027~F032)와 실제 코드 상태를 대조한다.
2. **작업 생성**: `tasks/` 디렉토리에 `XXX-설명.md` 문서를 작성한다. 각 문서에 목표·구현 단계·관련 파일·검증 기준을 포함한다.
3. **작업 구현**: 구조 → 데이터 → API → UI → 검증 순서로 진행한다.
4. **로드맵 업데이트**: 완료된 Task는 `✅ - 완료`로 표시한다.

---

## 개발 단계

### Phase 1~5: 완료 기준선 ✅

> 상세 내용은 `docs/ROADMAP_V2.md` 참조

---

### Phase 5-V3: V3 UX 개선 & 기능 보강

---

#### 5-V3-1. 그룹 A — 즉시 적용 (UI/설정 수정, DB 변경 없음)

---

- **Task 033 — F027: 인증 메일 확인 링크 리다이렉트 수정** ✅ 완료

  **대상 파일**: `app/auth/callback/route.ts`, `app/(auth)/login/`

  **구현 요점**
  - `app/auth/callback/route.ts`의 이메일 인증 완료 후 리다이렉트 경로를 `/login?verified=success`로 수정한다.
  - `app/(auth)/login/` 페이지에서 `verified=success` 쿼리 파라미터 처리를 추가한다.
  - 기존 `verified=pending` 처리 로직(Task 021)을 참고하여 `verified=success`일 때 "이메일 인증이 완료되었습니다. 로그인해주세요." 안내 문구를 표시한다.
  - shadcn/ui `Alert` 컴포넌트 (variant: default 또는 success 스타일) 활용.

  **수락 기준**
  - [x] 인증 메일 링크 클릭 후 `/login` 페이지로 이동한다.
  - [x] `/login` 페이지에 "이메일 인증이 완료되었습니다. 로그인해주세요." 안내 문구가 표시된다.
  - [x] 일반 로그인 진입 시에는 안내 문구가 표시되지 않는다.

---

- **Task 034 — F029: 키워드 분석 탭 전체 키워드 표시 + 필터 옵션** ✅ 완료

  **대상 파일**: 캠페인 상세 > 키워드 분석 탭 컴포넌트, `/api/campaigns/[campaignId]/inefficient-keywords/route.ts`

  **구현 요점**
  - 기존 비효율 키워드 기본 필터 조건(`adCost > 0 AND orders = 0`)을 제거하여 전체 키워드를 기본 표시로 변경한다.
  - 기본 정렬을 광고비 내림차순으로 변경한다.
  - 기존 컬럼 헤더 클릭 정렬 기능은 유지한다.
  - 필터 토글 버튼 2종을 추가한다:

  | 필터 옵션                             | 조건                        | 기본값 |
  | ------------------------------------- | --------------------------- | ------ |
  | 광고비·주문 수 모두 0인 키워드만 보기 | `adCost = 0 AND orders = 0` | OFF    |
  | 주문 발생 키워드만 보기               | `orders >= 1`               | OFF    |
  - 두 필터는 동시에 활성화될 수 없다 (하나 선택 시 나머지 비활성화).
  - API 레벨 또는 클라이언트 레벨에서 필터 조건을 처리한다. 데이터 규모에 따라 클라이언트 필터링 우선 검토.

  **수락 기준**
  - [x] 키워드 분석 탭 진입 시 전체 키워드가 표시된다.
  - [x] 기본 정렬이 광고비 내림차순이다.
  - [x] "광고비·주문 수 0 키워드만 보기" 필터 활성화 시 해당 조건의 키워드만 표시된다.
  - [x] "주문 발생 키워드만 보기" 필터 활성화 시 주문 건수 1개 이상인 키워드만 표시된다.
  - [x] 두 필터가 동시에 활성화되지 않는다.

---

#### 5-V3-2. 그룹 B — API/쿼리 수정 (데이터 모델 변경 없음)

---

- **Task 035 — F028: 대시보드 기간 설정 + 캠페인 목록 지표/증감** ✅ 완료

  **대상 파일**: `app/dashboard/`, `/api/campaigns/route.ts`, `src/components/dashboard/filter-bar.tsx`

  **구현 요점**
  - 대시보드 페이지 상단(캠페인 목록 위)에 날짜 범위 피커를 추가한다.
  - 기존 `FilterBar` 컴포넌트(`src/components/dashboard/filter-bar.tsx`)의 날짜 범위 선택 기능을 재사용하거나 참고하여 구현한다.
  - 기본 설정값: 오늘 기준 최근 7일 (`today - 6일 ~ today`)
  - 선택 가능 단위: 7일, 14일, 30일, 직접 입력

  캠페인 목록 지표 표시:
  - 기존 `/api/campaigns` GET 엔드포인트에 `startDate`, `endDate` 쿼리 파라미터를 추가한다.
  - 이전 동일 기간(현재 기간과 동일 일수, Task 026 방식과 동일)을 자동 계산하여 `prevMetrics`로 응답에 포함한다.
  - 각 캠페인 카드/행에 표시할 지표:
    - 총 광고비 (원 단위 포맷)
    - 평균 ROAS (소수점 2자리, % 단위)
    - 총 매출액 (원 단위 포맷)
  - 증감 표시 형식:
    ```
    총 광고비
    28,841원
    ▲ +12.3%
    ```
  - 증감 방향 색상: 광고비는 상승 시 빨간색, ROAS·매출액은 상승 시 녹색 (Task 026과 동일)
  - 이전 기간 데이터 없을 경우 증감 표시 생략

  **수락 기준**
  - [x] 대시보드 상단에 날짜 범위 피커가 표시된다.
  - [x] 기본값이 최근 7일로 설정된다.
  - [x] 기간 변경 시 캠페인 목록의 지표가 재조회된다.
  - [x] 캠페인 목록에 총 광고비, 평균 ROAS, 총 매출액이 표시된다.
  - [x] 이전 동일 기간 대비 증감율이 색상 구분과 함께 표시된다.
  - [x] 이전 기간 데이터 없는 경우 증감 표시가 생략된다.

---

#### 5-V3-3. 그룹 C — DB 마이그레이션 포함 (높은 복잡도)

> ⚠️ **주의**: Task 036은 Prisma 마이그레이션이 포함되어 있다. 프로덕션 적용 전 스테이징 환경에서 검증 필수.

---

- **Task 036 — F030: 캠페인 일 예산 / 목표 ROAS 설정 관리** ✅ 완료

  **대상 파일**: `prisma/schema.prisma`, `prisma/prisma.config.ts`, 캠페인 상세 > 대시보드 탭, 신규 API 라우트

  **DB 마이그레이션**: `CampaignTarget` 신규 테이블 생성

  ```prisma
  model CampaignTarget {
    id            String    @id @default(uuid())
    workspaceId   String
    campaignId    String
    effectiveDate DateTime  @db.Date  // 이 값이 적용되기 시작하는 날짜
    dailyBudget   Int?                // 일 예산 (원), null = 미설정
    targetRoas    Float?              // 목표 ROAS (%), null = 미설정
    createdAt     DateTime  @default(now())
    updatedAt     DateTime  @updatedAt

    workspace Workspace @relation(fields: [workspaceId], references: [id])

    @@unique([workspaceId, campaignId, effectiveDate])
    @@index([workspaceId, campaignId, effectiveDate])
  }
  ```

  **구현 요점**
  - `npx prisma migrate dev --name add_campaign_target_table`로 마이그레이션 적용.
  - effectiveDate 기반 값 조회: `effectiveDate <= D`인 레코드 중 최신 값 사용.
  - 캠페인 상세 > 대시보드 탭에 일 예산/목표 ROAS 설정 섹션 추가.
  - 미설정 상태 UI: "📋 일 예산이 설정되지 않았습니다. [설정하기] 버튼을 클릭해 입력해주세요."
  - 입력 폼 필드: 일 예산 (원), 목표 ROAS (%), 적용 시작일 (DatePicker, 기본값: 오늘)
  - 변경 이력 테이블(간략 토글)을 제공한다.
  - Task 035에서 추가되는 대시보드 캠페인 카드에 현재 유효 일 예산/목표 ROAS 표시 (미설정 시 "-")

  신규 API 엔드포인트:

  | 메서드   | 엔드포인트                                       | 설명                            |
  | -------- | ------------------------------------------------ | ------------------------------- |
  | `GET`    | `/api/campaigns/[campaignId]/targets`            | 전체 설정 이력 조회             |
  | `GET`    | `/api/campaigns/[campaignId]/targets/current`    | 현재 유효한 값 조회 (날짜 기준) |
  | `POST`   | `/api/campaigns/[campaignId]/targets`            | 새 값 등록 (effectiveDate 포함) |
  | `PATCH`  | `/api/campaigns/[campaignId]/targets/[targetId]` | 특정 이력 수정                  |
  | `DELETE` | `/api/campaigns/[campaignId]/targets/[targetId]` | 특정 이력 삭제                  |

  **수락 기준**
  - [x] Prisma 마이그레이션이 정상 적용된다.
  - [x] 캠페인 상세 > 대시보드 탭에서 일 예산/목표 ROAS를 입력할 수 있다.
  - [x] 미설정 상태에서 입력 유도 UI가 표시된다.
  - [x] 입력 폼에 적용 시작일(기본: 오늘)을 지정할 수 있다.
  - [x] 저장 후 해당 effectiveDate 이후 날짜의 값으로 반영된다.
  - [x] 과거 일자를 effectiveDate로 설정하여 이전 이력도 수정 가능하다.
  - [x] 대시보드 캠페인 목록에 현재 유효한 일 예산/목표 ROAS가 표시된다.

---

- **Task 037 — F031: 캠페인 관리 지표 — 일 예산 소진율 & 목표 ROAS 달성율** ✅ 완료

  **대상 파일**: 캠페인 상세 > 대시보드 탭 컴포넌트, `/api/campaigns/[campaignId]/metrics/route.ts`

  **선행 조건**: Task 036 (F030) 완료 후 진행

  **구현 요점**
  - 캠페인 상세 > 대시보드 탭 내 기존 KPI 카드 그룹 위에 "광고 관리 현황" 섹션 추가.
  - 카드 또는 배너 형태로 기존 KPI 카드와 시각적으로 분리.

  일 예산 평균 소진율 계산:

  ```
  일별 소진율 = 해당 일 광고비 / 해당 일의 유효 예산 × 100
  평균 소진율 = 예산 설정일 기준 일별 소진율의 평균
  ```

  - 표시 형식: `XX.XX%` (소수점 2자리)
  - 미설정 상태: "해당 기간에 설정된 일 예산이 없습니다."

  목표 ROAS 평균 달성율 계산:

  ```
  일별 달성율 = 해당 일 실제 ROAS / 해당 일의 유효 목표 ROAS × 100
  평균 달성율 = 목표 ROAS 설정일 기준 일별 달성율의 평균
  ```

  - 표시 형식: `XX.XX%` (소수점 2자리)
  - 미설정 상태: "해당 기간에 설정된 목표 ROAS가 없습니다."

  `/api/campaigns/[campaignId]/metrics` 응답에 신규 필드 추가:
  - `budgetUtilization`: 일 예산 평균 소진율 (Float, nullable)
  - `roasAchievement`: 목표 ROAS 평균 달성율 (Float, nullable)
  - `CampaignTarget` 이력과 `AdRecord` 데이터를 조인하여 서버에서 계산.

  **수락 기준**
  - [x] 대시보드 탭 상단에 "광고 관리 현황" 컴포넌트가 기존 KPI 카드 위에 표시된다.
  - [x] 일 예산 소진율이 `XX.XX%` 형식으로 표시된다.
  - [x] 목표 ROAS 달성율이 `XX.XX%` 형식으로 표시된다.
  - [x] 날짜 필터 변경 시 두 지표가 재계산된다.
  - [x] 예산 미설정 시 "해당 기간에 설정된 일 예산이 없습니다." 문구가 표시된다.
  - [x] 목표 ROAS 미설정 시 "해당 기간에 설정된 목표 ROAS가 없습니다." 문구가 표시된다.

---

- **Task 038 — F032: 예산/목표 ROAS 변경 시 메모 팝업** ✅ 완료

  **대상 파일**: 캠페인 상세 > 대시보드 탭 컴포넌트, `DailyMemo` API (기존 F005)

  **선행 조건**: Task 036 (F030) 완료 후 진행

  **구현 요점**
  - F030 설정 저장 후 메모 저장 여부를 확인하는 shadcn/ui Dialog를 표시한다.
  - 팝업 구성:
    1. 제목: "변경 내용을 메모로 남기시겠습니까?"
    2. 자동 생성 메모 내용 (수정 가능 텍스트):
       - 일 예산 변경 시: `일 예산 변경: {이전 예산}원 → {변경 예산}원`
       - 목표 ROAS 변경 시: `목표 ROAS 변경: {이전 목표 ROAS}% → {변경 후 목표 ROAS}%`
       - 둘 다 변경 시 두 줄로 표시
    3. 날짜 선택 DatePicker (기본값: 오늘)
    4. 버튼: [메모 저장] / [건너뛰기]
  - 기존 `DailyMemo` CRUD API(F005) 활용 (Task 028과 동일 방식).
  - 해당 날짜에 기존 메모가 있으면 줄바꿈 후 내용 추가 (덮어쓰기 금지).

  **수락 기준**
  - [x] 예산/목표 ROAS 저장 후 메모 팝업이 표시된다.
  - [x] 팝업에 변경 내용이 자동 생성된 문구로 표시된다.
  - [x] 날짜 선택 DatePicker가 오늘 날짜를 기본으로 표시한다.
  - [x] 날짜를 변경하여 다른 날짜에 메모를 저장할 수 있다.
  - [x] [메모 저장] 클릭 시 해당 날짜 메모에 내용이 기록된다.
  - [x] 기존 메모가 있을 경우 덮어쓰지 않고 내용이 추가된다.
  - [x] [건너뛰기] 클릭 시 팝업만 닫히고 메모는 기록되지 않는다.

---

### Phase 6: 분석 고도화

---

- **Task 015 — 진단 엔진 고도화** (ROADMAP V2에서 이관)

  **대상 파일**: `src/lib/diagnosis-engine.ts` (신설), `app/api/campaigns/[campaignId]/diagnosis/route.ts` (신설)

  **구현 요점**
  - `src/lib/diagnosis-engine.ts` 신설하여 진단 액션 판단 로직을 구현한다.
  - `/api/campaigns/[id]/diagnosis` 엔드포인트를 구현한다.
  - 기존 `inefficient-keywords` 로직(`app/api/campaigns/[campaignId]/inefficient-keywords/route.ts`)을 재활용한다.
  - 진단 액션 5가지:

  | 액션              | 조건                                                |
  | ----------------- | --------------------------------------------------- |
  | `STOP_KEYWORD`    | `adCost > 기준치 AND orders1d = 0`인 키워드 존재 시 |
  | `LOW_CTR`         | 캠페인 평균 CTR의 50% 미만 구간이 3일 이상 연속 시  |
  | `HIGH_ROAS`       | ROAS > 300% 초과 캠페인 → 예산 증액 제안            |
  | `CHECK_ROAS`      | 최근 7일 ROAS가 이전 7일 대비 30% 이상 하락 시      |
  | `ZERO_IMPRESSION` | 최근 3일 `impressions = 0` → 광고 상태 점검 제안    |
  - "오늘의 낭비 예산" UI 카드 및 "성과 개선 액션 5선" 카드 표시.

  **수락 기준**
  - [ ] 진단 엔드포인트가 캠페인 데이터를 기반으로 액션 목록을 반환한다.
  - [ ] 5가지 진단 액션이 각 조건에 맞게 동작한다.
  - [ ] "오늘의 낭비 예산" UI가 캠페인 상세 화면에 표시된다.
  - [ ] "성과 개선 액션 5선" 카드가 표시된다.

---

## 현재 상태 스냅샷

| 항목                 | 상태                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| V1 MVP 구현률        | 완료 (Phase 1~4)                                                        |
| V2 구현률            | 완료 (Task 020~032)                                                     |
| 프로덕션 배포        | 완료 — https://coupang-ad-manager-iota.vercel.app                       |
| V3 진행률            | 6 / 6 ✅ (Task 033~038 완료)                                            |
| Task 015 (진단 엔진) | 미완료 → Phase 6 대기                                                   |
| 주요 리스크          | 그룹 C (Task 036) DB 마이그레이션 — 프로덕션 적용 전 스테이징 검증 필요 |

---

## 권장 실행 순서

```
Phase 5-V3 그룹 A (Task 033, 034 — 병렬 가능)
  ↓
Phase 5-V3 그룹 B (Task 035)
  ↓
Phase 5-V3 그룹 C (Task 036 → Task 037, 038 병렬 가능)
  ↓
Phase 6 (Task 015)
```

**병렬 가능 구간**

- 그룹 A: Task 033, 034는 독립적으로 병렬 진행 가능
- 그룹 C: Task 037, 038은 Task 036 완료 후 병렬 진행 가능
