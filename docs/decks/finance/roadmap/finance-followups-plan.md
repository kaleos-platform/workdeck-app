# 재무 후속 정리 계획 (환불 처리 이후)

- 작성: 2026-10-03
- 배경: 환불 처리(#985~#995) 작업 중 발견한 기존 문제와 남은 정리 항목
- 브랜치: `finance-followups` (origin/main 기준)
- **상태: 1~4 완료·운영 반영(2026-10-03)** — PR-A #996→#997, PR-B #998→#999(코드) + #1000→#1001(DROP COLUMN, `e64c9628`). 5는 미착수.

## 요약

| #   | 항목                                  | 영향                                                                        | 규모               | 배포          |
| --- | ------------------------------------- | --------------------------------------------------------------------------- | ------------------ | ------------- |
| 1   | 거래내역 합계가 카드 취소 부호를 무시 | **운영 실영향**: 취소 6건(231,920원)만큼 합계가 현금흐름과 어긋남           | 작음               | ✅ #997       |
| 2   | 날짜 경계가 서버 로컬 시간대에 의존   | 운영(UTC)은 무영향, 로컬 dev·비UTC 환경에서 월 경계 거래 누락·저장값 틀어짐 | 작음               | ✅ #997       |
| 3   | 폐기된 방향 가드 e2e 테스트           | e2e 실행 시 2건 실패(가드 제거됨)                                           | 작음               | ✅ #997       |
| 4   | `FinCategory.isContra` 컬럼 정리      | 기능 영향 없음, 죽은 개념 제거                                              | 중간(마이그레이션) | ✅ #999·#1001 |
| 5   | 열린 PR #884·#885와 충돌 가능성       | 그 PR들을 재개할 때                                                         | —                  | 미착수        |

## 1. 거래내역 합계의 카드 취소 부호

**현상:** 거래내역 상단 수입/지출 합계(`queryTransactions` summary)는 `groupBy`의 원금액 합을 그대로 쓴다. 현금흐름 표·대시보드는 `signedAmount`로 `cancelFlag`에 '취소'가 들어간 거래를 음수로 상계한다.

- 운영 데이터: `cancelFlag='취소'` 출금 6건, 231,920원. 거래내역 지출 합계가 현금흐름보다 **463,840원(2배)** 크게 나온다(상계 대신 가산).
- 현금흐름 우측 패널의 검색 중 합계(`cashflow-view.tsx:1474`)도 같은 문제.

**수정:**

- `src/lib/finance/queries.ts:268` — `groupBy`에 `cancelFlag`를 추가하고 그룹마다 `signedAmount` 적용 후 `cashSection`.
- `cashflow-view.tsx:1474` — 행 합계에 취소 부호 반영(`aggregate.ts`의 `signedAmount` 재사용. 클라이언트 import 가능한 순수 모듈).
- 행 표시(통장 그대로)는 바꾸지 않는다.

**검증:** `contra.test.ts`에 취소 거래 1건을 추가해 거래내역 합계 = 현금흐름 합계 확인. 운영 반영 후 2026년 해당 월 거래내역 합계와 현금흐름 합계 대조.

## 2. 날짜 경계의 서버 시간대 의존

**저장 규약:** `txnDate`는 KST 벽시계 값을 UTC로 저장한다(`aggregate.ts` `ymOf` 주석). 읽기는 #990에서 UTC getter로 통일됐지만, **경계 생성과 저장은 아직 로컬 시간대**를 쓴다.

| 위치                                          | 현재                             | 문제(서버가 UTC가 아닐 때)                    |
| --------------------------------------------- | -------------------------------- | --------------------------------------------- |
| `aggregate.ts:76` `monthBounds`               | `new Date(y, m-1, 1)`            | 월 경계가 9시간 앞당겨져 월말·월초 거래 누락  |
| `queries.ts:194-195` from/to                  | ``new Date(`${from}T00:00:00`)`` | 거래내역 기간 필터 9시간 어긋남               |
| `imports/commit-staging/route.ts:31` `toDate` | TZ 없는 ISO를 로컬로 파싱        | 로컬에서 업로드하면 규약과 다른 시각으로 저장 |

- 운영(Vercel=UTC)에서는 로컬=UTC라 결과가 같다 → **운영 수치 변화 없음**.
- 실제 피해: 로컬 dev QA에서 8/1 01시(KST) 거래가 현금흐름 표·대시보드에서 통째로 빠지는 현상을 이번 작업 중 확인.

**수정:** 세 곳 모두 UTC로 명시(`Date.UTC(...)`, `...T00:00:00Z`, TZ 없는 ISO에 `Z` 부여). 다른 `new Date(` 경계 생성 지점도 함께 grep해 정리.

**검증:** `TZ=Asia/Seoul`과 `TZ=UTC` 두 환경에서 `finance-aggregate-kst.test.ts`·`finance-ymd-kst.test.ts` + 경계 테스트(월말 23시 KST 거래가 그 달에 집계) 통과. 운영 반영 후 현금흐름·대시보드 수치가 배포 전과 동일한지 대조.

## 3. 폐기된 방향 가드 e2e 테스트

`src/lib/__tests__/finance-classify-direction-guard.e2e.test.ts`는 "OUT 행에 INCOME 계정 지정 시 400"을 검증한다. #993에서 가드를 제거했으므로 e2e(`jest.config.e2e.ts`) 실행 시 2건이 실패한다. 기본 `npm test`는 e2e를 제외해서 지금까지 드러나지 않았다.

**수정:** 새 정책으로 바꾼다 — 출금 행에 수익 계정 지정 시 200 + 규칙 미학습(`matchedRuleId` null), 정상 방향은 학습. 파일명도 정책에 맞게 변경.

**검증:** dev DB로 e2e 실행.

## 4. `FinCategory.isContra` 컬럼 정리

- 현재 쓰임: 신규 공간 시드의 `매출환입(반품·환불)` 키워드 추천 방향(`directionForType(type, isContra)`)뿐. 운영에 `isContra=true` 계정 1개 남음(값만 있고 동작 영향 없음).
- 새 방식에선 환불을 원래 계정에 분류하므로 시드의 `매출환입` 리프와 `환불` 키워드도 의미가 약하다.

**수정:**

- 시드에서 `contra`·`매출환입` 키워드 제거(리프 유지 여부는 결정 필요 — 아래).
- `directionForType`의 `isContra` 인자, `rule-suggest`·`staging/route.ts`의 `isContra` 사용 제거.
- 마이그레이션 `DROP COLUMN "isContra"` — **파괴적 변경**이라 별도 PR, `migrate diff`로 생성하고 DROP이 이 컬럼 하나뿐인지 확인.

**결정:** 신규 공간 시드에서 `매출환입(반품·환불)` 리프도 뺀다(환불은 원래 계정에 분류). 컬럼 삭제는 빌드 중 구 코드가 컬럼을 읽지 않도록 코드 제거(#999) → DROP(#1001) 2단계로 배포.

## 5. 열린 PR #884·#885 (결제 미납 시 쓰기 차단)

#885는 finance 저장 API 19개 파일에 `resolveDeckContext({ write })`를 넣는다. 그중 `staging/[id]`, `staging/bulk`, `transactions/[id]`, `transactions/bulk`, `categories`, `rules`는 이번에 방향 가드를 제거하거나 수정한 파일이라 머지 시 충돌이 예상된다. 2026-09-12에 올라온 PR이라 그 사이 main이 크게 바뀌었다.

**처리:** 이 계획 범위 밖. 그 PR을 재개할 때 origin/main 기준으로 리베이스하고, 충돌 지점은 "가드 블록 삭제 + write 옵션 추가"로 해결.

## 진행 중 발견(범위 밖)

- `src/lib/finance/__tests__/coverage.e2e.test.ts`의 imports 목록 테스트 2건이 origin/main에서도 실패했다. 원인: `3bc53b35`(2026-08-02)에서 imports 목록 기본값이 "검토중만"으로 바뀌었는데 테스트는 전체 반환을 가정. **해결(2026-10-05):** 두 테스트에 `includeCommitted=1`, 기본값(검토중만) 테스트 추가.

## 진행 순서

1. **PR-A (코드만, 스키마 변경 없음):** 1·2·3 → develop → develop URL 검증 → main.
2. **PR-B (마이그레이션):** 4 → develop(마이그레이션 적용 확인) → main → 운영 `_prisma_migrations` 확인.
3. 5는 해당 PR 재개 시.

각 PR은 finance jest·tsc·eslint·build 통과, 로컬(QA 계정)과 develop URL 확인 후 릴리스한다.
