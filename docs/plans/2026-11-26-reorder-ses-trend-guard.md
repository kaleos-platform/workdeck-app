# 발주 예측 「지수평활+추세」(SES_TREND) 과다 예측 가드

작성 2026-11-26 · 브랜치 `fix/reorder-ses-trend-guard`(origin/develop 기준)

## 배경 (운영 MCP 관측, AML 공간 펠트 수납박스 `cmorvht4q000004jr29nycq7n`)

| 날짜       | 추천 모델     | 총 발주 | 비고                              |
| ---------- | ------------- | ------- | --------------------------------- |
| 11-23 이전 | 이동평균 90일 | 20      |                                   |
| 11-24 오전 | 지수평활+추세 | 120     | BGE-M 20, BGE-L 50, CHK-L 50      |
| 11-24 오후 | 지수평활+추세 | 160     | DGR-L 40 추가                     |
| 11-26      | 지수평활+추세 | 210     | DGR-M 150(예측 5.53/일), BGE-L 60 |

- 상품 전체 30일 판매 165 vs 직전 30일 219(−25%)로 수요는 줄었다.
- DGR-M 실제 30일 판매 25개(0.83/일)인데 예측은 5.53/일(약 7배). CHK-L 0.32(MA_BLEND) → 1.24.
- 판매 상위 8개 상품은 SES_TREND 추천 0개라 현재 영향은 이 상품뿐이지만, 일 단위로 판매가 튀는 상품이면 어디든 같은 일이 생길 수 있다.

## 원인 (`src/lib/inv/reorder-engine/models.ts` `holt`)

1. 일 단위 판매에 Holt 선형(α 0.3, β 0.1)을 그대로 적용한다. 며칠 판매가 튀면 level·trend가 함께 오른다.
2. 예측은 1..h일의 `level + k·trend` 평균이다. h = 리드타임 20 + 커버 30 = 50이면 평균은 `level + 25.5·trend`가 되어, trend가 0.1만 되어도 +2.5/일이 붙는다.
3. 백테스트(`backtest.ts`)는 마지막 50일 한 구간으로 모델을 고른다. 색상 간 수요 이동이 있는 상품에서는 오르는 옵션을 잘 따라가는 추세 모델이 1위가 되고, 내리는 옵션은 0 바닥에 재고도 있어 발주에서 상쇄되지 않는다.

## 목표

- SES_TREND 일률이 최근 실적과 동떨어지게 커지지 않게 한다.
- 위저드·MCP 미리보기·발주 계획·재고 현황 등급·velocity 툴이 같은 함수(`forecastRates`)를 쓰므로 한 곳에서 고친다.
- 다른 모델(MA30·MA90·MA_BLEND·CROSTON) 값은 바뀌지 않는다.

## 변경 (파일 2개)

### `src/lib/inv/reorder-engine/models.ts`

**상한 하나만 둔다**: `SES_TREND ≤ 2 × max(최근 비품절 30일 평균, 최근 비품절 90일 평균)`.

- 기준은 Holt 가 쓰는 시계열(`valid` = 품절일 제외)과 같은 데서 뽑는다. 달력 30·90일을 자른 뒤 품절일을 빼는 MA30·MA90 을 쓰면, 최근 90일이 통째로 품절일 때 상한이 0 이 되어 과거 유효 수요를 지운다(Codex 지적 1).
- 상한 2배 근거: 50일 horizon 의 중간(25일 뒤) 수요가 최근 평균의 2배를 넘는다는 예측을 추세 모델 혼자 내지 못하게 한다. 실제 급성장은 사용자가 위저드에서 수량·모델을 직접 바꾼다. `ponytail:` 주석으로 상한 근거와 바꿀 자리를 남긴다.
- 백테스트도 `forecastRates` 를 거치므로 상한이 적용된 값으로 순위를 매긴다.

### `src/lib/inv/reorder-engine/__tests__/models.test.ts` (신규)

- 끝 며칠 판매가 튀는 시계열(0.8/일 85일 + 6/일 5일, h=50) → SES_TREND = 2 × max(비품절 30·90 평균).
- 평평한 시계열 → SES_TREND ≈ MA30(상한 안 걸림, 기존 값 그대로).
- 완만한 증가(상한 밑) → 상한 전 Holt 값 그대로.
- 최근 90일 품절 + 그 이전 판매 → SES_TREND > 0(상한이 0 으로 만들지 않음).
- MA30·MA90·MA_BLEND·CROSTON 값은 그대로.

## Codex 검토 반영 (2026-11-26, 지적 5건 — 반영 3, 보류 2)

1. [반영] 품절일이 최근 창을 덮으면 상한이 0 → 상한 기준을 비품절 관측일 평균으로 바꾸고 테스트 추가.
2. [반영·일부] 상한·감쇠가 급성장 옵션을 과소 예측 → 감쇠(φ) 제거, 상한 1.5배→2배 완화. 현재 판매 상위 8개 상품 중 SES_TREND 추천 0개라 즉시 영향은 수납박스뿐. 과거 데이터 재생 비교는 운영 DB 접근이 막혀 배포 후 MCP 미리보기 비교로 대신한다.
3. [보류] 이전 SES_TREND 정산 실적(realized)이 섞임 → AML 공간 정산(MEASURED) 계획 0건(11-26 `sellerhub_get_reorder_status`)이라 섞일 실적이 없다. 실적이 쌓이면 상한 적용 후 값으로만 쌓인다.
4. [반영] 비선택 모델도 추천을 바꿀 수 있음 → 검증 4에 판매 상위 상품 추천 모델·수량의 전후 비교(11-24 조사표 기준)를 명시.
5. [해당 없음] 감쇠 갱신식 정확성 → 감쇠를 빼서 갱신식 변경이 없다.

## 하지 않는 것

- 백테스트 방식 변경(여러 구간 평균, 점수 근소차일 때 단순 모델 우선): 상한으로 SES_TREND 값 자체가 묶이면 순위가 뒤집혀도 피해가 작다. 이번 수정으로도 튀면 그때 추가한다.
- 주 단위 집계 후 Holt 적용: 변경이 더 크다. 위와 같은 조건이면 추가한다.
- 위저드≠MCP 추천 차이(11-24 에디 관측): 같은 요청이라 계산은 같다. 이번 수정 후 다시 비교한다.

## 검증

1. `npx jest src/lib/inv/reorder-engine` — 새 테스트와 기존 테스트(backtest·plan-product·engine) 통과.
2. `npx tsc --noEmit`, `npm run lint`(변경 파일).
3. 운영 반영 후 MCP `sellerhub_get_reorder_preview`로 수납박스 재조회 → DGR-M 일 예측이 최근 평균의 2배 이하. 총 발주가 MA_BLEND 기준 수량과 비슷한 수준인지 확인한다.
4. 판매 상위 상품 미리보기의 추천 모델·총 수량을 11-24 조사값과 비교한다(머드팬티 `cmoimxy8z000004lkh9cf6car` MA90·140, 캡나시 `cmoinccpy000004jsv82iv6l1` MA_BLEND·30, 남자 대나무 팬티 `cmp1a16vq000904i9torc6rvz` MA30·20, 콰이엇울 슬리퍼 `cmu38e709000e04jnwvbzwywq` MA_BLEND·40). 추천 모델이 SES_TREND 로 바뀌거나 수량이 크게 달라지면 따로 검토한다.

## 릴리스·롤백

- PR base develop → 머지 → main cherry-pick 릴리스 PR(머지 전 main 기준 tsc).
- 롤백: 이 커밋 revert. 스키마·데이터 변경 없음. 이미 만든 발주 계획 수량은 바뀌지 않는다(저장된 값).

## 구현·로컬 검증 (2026-11-26)

- 공통 `forecastRates`에서 비품절 관측일 평균 기반 상한만 적용했다. Holt 갱신식은 그대로다.
- 신규 회귀 테스트 7개: 기존 코드에서 상한 사례 3개 실패를 확인한 뒤, 수정 후 발주 엔진 전체 7 suites / 65 tests 통과.
- 별도 코드 리뷰에서 correctness·회귀·계획 불일치 지적 없음.
- 전체 lint: 0 errors / 기존 다른 파일 warnings 64개. 변경 TypeScript 파일은 formatting 검사 통과.
- `npm run typecheck` 및 pre-push typecheck 통과.
- 기본 Turbopack build는 약 5분간 compile 단계 출력 갱신이 없어 TERM 종료(exit 143). 성공으로 간주하지 않았다.
- webpack 기본 heap build는 약 4GB 한도에서 `JavaScript heap out of memory`(exit 134).
- `NODE_OPTIONS=--max-old-space-size=8192 npm run build -- --webpack`: compile·TypeScript·페이지 생성까지 통과(exit 0). 저장소 설정 변경 없음.
- [Draft PR #1650](https://github.com/kaleos-platform/workdeck-app/pull/1650), base `develop`. 구현 커밋 `99764585` 기준 CI migration-lint·rls-lockdown·Vercel preview 통과, visual-smoke는 조건에 따라 skip.
- 운영 배포·머지는 수행하지 않았다.
- 운영 MCP preview 비교, 큰 reorderRoundUnit 상품 조회, 에밀리 후속 보고 확인은 미완료. 현재 연결 도구에서 Workdeck/AML 조회 도구가 제공되지 않는다.
