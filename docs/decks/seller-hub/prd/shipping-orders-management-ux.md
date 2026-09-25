# 배송 데이터 관리 사용성 개선 설계

> 대상 deck: seller-hub (`/d/seller-ops/shipping/orders`)
> 작성일: 2026-09-24
> 상태: 설계 승인 완료, 구현 전

## 배경과 문제

배송 데이터 관리 화면은 완료된 배송 묶음에서 주문을 찾아 확인·수정·재등록하는 운영 화면이다. 현재 구조에는 세 가지 문제가 있다.

1. 배송 묶음 API가 기간과 무관하게 20건씩 페이지네이션하고, 화면은 현재 페이지에 이미 받아온 20건만 날짜로 거른다. 따라서 선택 기간에 해당하는 묶음이 다른 페이지에 있으면 사용자가 페이지를 이동하며 찾아야 한다.
2. 배송 묶음과 주문 목록이 상하로 배치되어 넓은 desktop에서도 묶음을 바꿔가며 주문을 비교하기 어렵다.
3. 상단 전체 주문 검색과 선택 묶음의 주문 검색 모두 `결제금액`을 표시하면서도 검색 대상으로 사용하지 않는다.

## 목표

- 선택 기간에 완료된 배송 묶음을 페이지 이동 없이 한 번에 조회한다.
- 넓은 화면에서 배송 묶음과 주문 목록을 좌우에 두어 묶음 전환과 주문 확인을 동시에 수행한다.
- 두 주문 검색 경로 모두 결제금액 검색을 같은 규칙으로 지원한다.

## 제외 범위

- 주문 목록 자체의 50건 페이지네이션은 유지한다.
- 배송 묶음 또는 주문의 DB schema는 변경하지 않는다.
- 접힘 상태를 `localStorage`나 서버에 저장하지 않는다.
- `1536px` 미만 화면에서 주문 표를 억지로 좌우 분할하지 않는다.
- 검색 DSL, 복합 조건 검색, 금액 범위 검색은 추가하지 않는다.

## 확정된 결정

| 항목 | 결정 |
| --- | --- |
| 기간 기준 | 배송 묶음 완료일 `completedAt` |
| 기간 경계 | KST 일자 기준, 시작일 00:00 이상·종료일 다음 날 00:00 미만 |
| 기간 결과 | 해당 기간의 완료 묶음 전체 반환, 묶음 페이지네이션 없음 |
| 기간 변경 시 선택 | 기존 선택이 새 결과에 없으면 선택 해제, 있으면 유지 |
| 넓은 화면 | `1536px` 이상에서 왼쪽 280px·오른쪽 가변 폭 좌우 배치 |
| 좁은 화면 | `1536px` 미만에서 기존 상하 배치 |
| 묶음 패널 | 기본 펼침, 사용자 수동 접기, 좁은 복구 rail 유지 |
| 접힘 상태 | component local state, 재방문 시 펼침 |
| 금액 검색 위치 | 상단 전체 주문 검색 + 선택 묶음 주문 검색 |
| 금액 일치 | 표시 금액을 정규화한 부분 일치 |

## 데이터 흐름

### 배송 묶음 기간 조회

`BatchList`는 기본 7일 또는 사용자가 고른 `dateFrom`·`dateTo`를 `/api/sh/shipping/batches`의 `from`·`to` query parameter로 보낸다.

API는 다음 순서로 처리한다.

1. 기존 `resolveDeckContext('seller-hub')`로 인증·deck 접근·Space context를 확인한다.
2. `from`, `to`가 함께 있는지와 `YYYY-MM-DD` 형식인지 검증한다.
3. 실제 존재하는 날짜인지, `from ≤ to`인지 검증한다.
4. KST 일자를 UTC instant 범위 `[from 00:00 KST, to 다음 날 00:00 KST)`로 변환한다.
5. `spaceId`, `status: 'COMPLETED'`, `completedAt` 범위를 모두 적용한다.
6. `completedAt desc`로 정렬하고 기간 내 결과 전체와 `total`을 반환한다.

`from`, `to`가 없는 기존 호출에는 현재 `page`, `pageSize` 동작을 유지한다. 이를 통해 배송 등록 등 다른 소비자의 API 계약을 바꾸지 않는다.

화면의 `날짜` 열도 `createdAt`이 아니라 `completedAt`을 표시한다. 완료 묶음에서 `completedAt`이 비정상적으로 `null`인 행은 기간 조회 조건상 결과에서 제외된다.

### 선택 상태

조회 성공 후 현재 `selectedBatchId`가 새 결과에 존재하는지 확인한다.

- 존재하면 선택과 오른쪽 주문 목록을 유지한다.
- 존재하지 않으면 `selectedBatchId`를 `null`로 바꾸고 주문 목록 대신 선택 안내 empty state를 표시한다.
- 첫 결과를 자동 선택하지 않는다.

## 화면 구성

### `1536px` 이상

page content를 `280px minmax(0, 1fr)` grid로 구성한다.

- 왼쪽: 기간 preset, 날짜 입력, 완료된 배송 묶음 목록
- 오른쪽: 선택한 묶음의 주문 필터, 주문 표, 주문 페이지네이션

왼쪽 묶음 목록만 세로 scroll하며 오른쪽 주문 표의 기존 가로 scroll, sticky 받는분 column, sticky action column은 유지한다. card 안에 card를 중첩하지 않고 각 panel을 하나의 surface로 둔다.

왼쪽 panel header의 chevron icon button으로 panel을 접는다. 접힌 상태에도 좁은 rail과 `배송 묶음 펼치기` button을 남겨 복구 동작을 명확히 한다. icon button에는 `aria-label`을 제공한다.

### `1536px` 미만

현재처럼 배송 묶음 위, 주문 목록 아래의 상하 배치를 사용한다. 이 구간에서는 panel 접기 control을 표시하지 않는다. 주문 표가 이미 약 1110px의 최소 폭을 필요로 하므로 좌우 panel을 강제하지 않는다.

## 결제금액 검색

두 API 경로에 같은 금액 matching 규칙을 적용한다.

- `/api/sh/shipping/orders`: 모든 완료 묶음의 상단 전체 검색
- `/api/sh/shipping/batches/[batchId]/orders`: 선택 묶음의 주문 목록 검색

검색어가 숫자, comma, 공백, 선택적인 끝의 `원`으로만 구성되면 금액 검색어로도 해석한다. comma·공백·`원`을 제거한 값과 주문의 `paymentAmount` 표시값을 비교해 부분 일치시킨다.

예를 들어 `paymentAmount = 39000`인 주문은 `390`, `39000`, `39,000`, `39,000원`으로 검색된다. 일반 문자가 섞인 검색어는 금액으로 해석하지 않는다. 기존 주문번호·받는분·전화·주소·상품명 matching은 그대로 OR 조건으로 유지한다.

두 검색 input의 placeholder에는 `결제금액`을 추가해 검색 가능 범위를 화면에서 알 수 있게 한다.

## 오류·상태 처리

- 잘못된 기간은 API가 `400`과 명확한 오류 message를 반환한다.
- 조회 실패는 기존 toast pattern을 유지한다.
- 조회 중에는 기존 loading row를 표시한다.
- 기간 내 결과가 없으면 `완료된 배송 묶음이 없습니다` empty state를 표시한다.
- 선택이 해제되면 오른쪽에는 `배송 묶음을 선택하세요` 안내를 표시한다.
- 기존 `spaceId` 조건과 PII masking·decrypt 정책은 변경하지 않는다.

## 구현 경계

변경 대상은 다음 feature boundary 안으로 제한한다.

- `app/d/seller-ops/shipping/orders/page.tsx`
- `src/components/sh/shipping/batch-list.tsx`
- `src/components/sh/shipping/order-detail-table.tsx`
- `src/components/sh/shipping/order-search-bar.tsx`
- `app/api/sh/shipping/batches/route.ts`
- `app/api/sh/shipping/batches/[batchId]/orders/route.ts`
- `app/api/sh/shipping/orders/route.ts`
- 날짜·금액 matching의 작은 shared helper와 해당 test

관련 없는 shipping 등록·파일 생성·DB schema는 수정하지 않는다. 새 dependency도 추가하지 않는다.

## 검증

### 자동 검증

- KST 시작·종료 경계가 UTC instant로 정확히 변환되는지 확인한다.
- 잘못된 날짜 형식, 존재하지 않는 날짜, 역전된 기간을 거부하는지 확인한다.
- 기간 조건이 `completedAt`에 적용되고 현재 Space의 완료 묶음만 반환하는지 확인한다.
- 금액 검색이 `390`, `39000`, `39,000`, `39,000원`을 일치시키고 일반 문자 검색어를 금액으로 오인하지 않는지 확인한다.
- 상단 전체 검색과 선택 묶음 검색이 같은 금액 matching 결과를 내는지 확인한다.

### UI 확인

- `1920px`: 좌우 배치, 묶음 panel 접기·복구, 주문 표 가로 scroll·sticky column 확인
- `1440px`: 상하 배치와 기존 주문 표 폭 확인
- 기간 preset·직접 입력 변경 시 전체 결과와 선택 유지·해제 확인
- 묶음 결과 없음, 주문 결과 없음, loading, API 오류 상태 확인

### 완료 전 명령

```bash
npm test -- <changed-tests> --runInBand
npm run typecheck
npm run lint
npm run build
```
