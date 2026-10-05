# 재무 거래 「분석 제외」 구분값 — 설계

- 작성일: 2026-10-05
- 대상: 재무 관리 deck (`/d/finance/*`)
- 상태: 설계 승인(명칭 확정) → spec 검토 대기

## 1. 배경과 목표

사업 계좌에 실제 비즈니스와 무관한 거래(개인 목적 급여 지급, 외부 계약 매출 등)가 섞여 들어온다.
이 거래들은 계정과목상으로는 정상(급여·매출)이라 현재 구조로는 걸러낼 수 없다.

- 지금 집계에서 빠지는 유일한 경로는 `isTransfer`이고, 이는 **계정과목 type=TRANSFER에 종속**된다.
- 현금흐름 상세의 `?exclude=`는 **계정과목 단위** 제외다 — 같은 계정 안의 일부 거래만 빼지 못한다.

**목표:** 거래 1건 단위로 「분석 제외」를 지정하고, 현금흐름·대시보드·손익 지표를 기본적으로
분석 대상 거래만으로 보되, 토글로 전체를 볼 수 있게 한다.

### 사용자 결정 사항

| 항목        | 결정                                                        |
| ----------- | ----------------------------------------------------------- |
| 구분 형태   | 단순 2분류 (분석 대상 / 분석 제외)                          |
| 지정 방식   | 수동 — 행별 토글 + shift 다중선택 일괄 지정. 자동 학습 없음 |
| 집계 기본값 | 기본 제외 + 「분석 제외 거래 포함」 토글                    |
| 명칭        | 「분석 제외」 (판매분석의 「판매분석 제외」와 용어 일관)    |

### 범위 밖 (YAGNI)

- 분류 규칙(FinClassRule) 학습으로 자동 지정
- 계정과목 단위 기본값
- 스테이징(업로드 검토) 단계 지정 — 확정 후 지정만
- 구분 세분화(개인/외부계약 등) — 필요 시 메모·계정과목으로 구분

## 2. 두 「제외」 기능의 관계

|           | 계정과목 제외 (기존)               | 분석 제외 (신규)                           |
| --------- | ---------------------------------- | ------------------------------------------ |
| 단위      | 계정과목(리프)                     | 거래 1건                                   |
| 저장      | URL `?exclude=` (일시적 보기 설정) | DB 컬럼 (거래의 영구 속성)                 |
| 적용 화면 | 현금흐름 상세만                    | 현금흐름·대시보드·Sankey·거래내역 요약·MCP |
| 해제      | URL에서 제거                       | 토글로 일시 포함 / 거래에서 지정 해제      |

UI 문구도 구분한다: 기존은 「계정 제외」, 신규는 「분석 제외」. URL 파라미터는 신규에
`includeExcluded=1`을 쓰고 `exclude`는 절대 재사용하지 않는다.

## 3. 데이터 모델

```prisma
model FinTransaction {
  // ...
  // 분석 제외 — 개인 목적 급여·외부 계약 등 본 사업과 무관한 거래.
  // true면 현금흐름·대시보드·손익 지표 집계에서 기본 제외(토글로 포함 가능). 계좌 잔액에는 영향 없음.
  excludeFromAnalysis Boolean @default(false)
}
```

- 마이그레이션: `npx prisma migrate dev --name finance_txn_exclude_from_analysis` (기존 행 전부 false → 배포 직후 화면 숫자 변화 없음)
- 인덱스 추가 안 함: 모든 집계 쿼리가 이미 `spaceId, txnDate` 범위로 좁힌 뒤 필터한다.
- `FinStagedRow`에는 추가하지 않는다.

**재업로드 보존:** `staging/commit/route.ts`의 upsert `update`는 `content`·`classification`·`memoPatch`만
쓴다 → 새 컬럼은 DUP_CHANGED·DUP_OVERWRITE 모두에서 자동 보존된다. 이 불변식은 e2e 테스트로 고정한다.

## 4. 지정 API (기존 경로 확장)

- `PATCH /api/finance/transactions/[id]` — body에 `excludeFromAnalysis?: boolean` 추가.
  기존 `isTransfer` 토글과 같은 방식(`typeof === 'boolean'`일 때만 반영).
- `POST /api/finance/transactions/bulk` — `{ ids, excludeFromAnalysis: boolean }` 분기 추가.
  `spaceId` 소유 검증은 기존 bulk 분기와 동일하게 `where: { id: { in: ids }, spaceId }`.
- 계정과목 재분류 경로(`[id]`, bulk categoryId)는 이 컬럼을 건드리지 않는다
  (`isTransfer`처럼 계정과목에서 파생되지 않음 — 덮어쓰기 위험 없음).

## 5. 집계 필터 — 적용 지점 체크리스트

공통 옵션 `includeExcluded?: boolean`(기본 false). false면 거래 조회 `where`에
`excludeFromAnalysis: false`를 추가한다. **기존 `isTransfer` 제외 지점을 전수 체크리스트로 삼는다.**

| 지점                                                       | 처리                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `queryCashflow` 거래 `findMany` (`queries.ts:~325`)        | where 필터. 손익 지표(`computePnlMetrics`)·손익계산서·안전한계율(`buildPnlStatement`/`buildPnlSummary`)은 모두 이 행에서 파생 → 자동 반영 |
| `queryDashboard` 수입/지출 `txns` (`queries.ts:~653`)      | where 필터                                                                                                                                |
| `queryDashboard` `repaymentTxns`·스냅샷·부채               | **필터 금지** — 실제 돈/부채 잔액                                                                                                         |
| `cashflow/sankey/route.ts` 거래 `findMany`                 | where 필터                                                                                                                                |
| `queryTransactions` 요약합계 `sumWhere` (`queries.ts:234`) | §6 참조                                                                                                                                   |
| `aggregate.ts:114/129/142`                                 | 변경 없음 — DB에서 이미 걸러진 행만 들어옴                                                                                                |
| `export/route.ts`                                          | 행 필터 없음, `구분` 컬럼에 「분석 제외」 표기(§8)                                                                                        |
| `snapshot-rebuild.ts`                                      | 변경 없음 — 잔액은 전체 거래 기준                                                                                                         |
| MCP `agent/tools/finance-tools.ts`                         | 옵션 미전달 → 기본값(제외) 상속. 도구 파라미터 노출은 범위 밖                                                                             |

라우트: `app/api/finance/{cashflow,dashboard,cashflow/sankey}/route.ts`에서 `includeExcluded=1` 쿼리를 파싱해 전달.

## 6. 거래내역 화면 (`transactions-view.tsx`)

- 필터 추가: 「구분: 전체 / 분석 대상 / 분석 제외」 → API `scope=all|included|excluded`, 기본 `all`.
- 행 목록(`where`)은 scope를 따른다.
- **요약 합계(수입/지출)**: `queries.ts:232` 주석대로 요약은 현금흐름 정의와 일치해야 한다.
  → `sumWhere`는 `isTransfer: false`에 더해 **`excludeFromAnalysis: false`를 기본 적용**한다
  (= 현금흐름 기본값과 동일). 예외: `scope=excluded`(분석 제외 거래만 보는 중) 또는
  `includeExcluded=1`(현금흐름 토글 on 상태에서 온 드릴다운)이면 적용하지 않는다.
  즉 행 범위는 `scope`, 요약 합계 범위는 `includeExcluded`가 결정한다.
  요약 영역에 「분석 제외 거래는 합계에서 빠집니다」 힌트(`info-hint.tsx`) 추가.
- 행 표시: 적요 옆 「분석 제외」 배지(muted).
- 행 메뉴: 「분석 제외로 지정 / 해제」.
- 일괄 액션 바(기존 shift 다중선택): 「분석 제외 지정」·「분석 제외 해제」 버튼.

## 7. 현금흐름·대시보드 토글

- 상단 컨트롤 영역에 스위치 「분석 제외 거래 포함」. 상태 = URL `?includeExcluded=1`
  (기존 `?exclude=`와 같은 URL 단일 소스 패턴 — 새로고침·링크공유 유지, 저장소 추가 없음).
- 현금흐름 우측 거래 패널(드릴다운, `cashflow-view.tsx:1314/1433`의 `excludeTransfer: '1'` 호출)은
  **현금흐름 토글 상태**를 그대로 전달한다 — 패널 합계가 표 셀 값과 일치해야 한다.
  패널 → `queryTransactions`는 토글 off면 `scope=included`, 토글 on이면 `scope=all&includeExcluded=1`.
- 대시보드는 「현금 잔액」(스냅샷, 전체 기준)과 「수입/지출」(필터 기준)을 같은 화면에 보여준다.
  토글 off이고 해당 기간 분석 제외 거래가 있으면 수입−지출이 잔액 변동과 맞지 않는다 →
  수입/지출 카드에 「분석 제외 N건 제외됨」 힌트 표시(대시보드 응답에 `excludedCount` 추가).

## 8. 엑셀 export

- 행은 전체 유지. 기존 `구분` 값(이체/수입/지출) 옆에 별도 컬럼 「분석 제외」(Y/공란) 추가.

## 9. 테스트

- 단위: `queryCashflow`/`queryDashboard`/sankey where 구성 — `includeExcluded` 유무별 필터 포함 여부.
- e2e(`finance-commit-snapshot.e2e.test.ts` 패턴):
  1. 분석 제외 지정 거래가 재업로드(DUP_CHANGED, DUP_OVERWRITE) 후에도 `excludeFromAnalysis=true` 유지.
  2. bulk 지정이 다른 space의 id를 무시.
  3. 대시보드 `repaymentTxns`·잔액이 분석 제외 지정과 무관.
- 수동: 거래 지정 → 현금흐름 셀 값 감소 → 토글 on 복원 → 드릴다운 패널 합계 = 셀 값.

## 10. 변경 파일 예상

- `prisma/schema.prisma` + 마이그레이션 1개
- `src/lib/finance/queries.ts`
- `app/api/finance/{cashflow,dashboard,cashflow/sankey,transactions,transactions/[id],transactions/bulk,export}/route.ts`
- `src/components/finance/{transactions-view,cashflow-view,dashboard-view}.tsx`
- 테스트 2~3개
