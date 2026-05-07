# 채널상품 — 실체 기반 모델로 재설계

## Context

판매채널 상품 화면(`/d/seller-ops/products/listings`)은 listing들을 묶어 보여준다.
그러나 DB에 채널상품(그룹) 엔티티는 없고, listing의 `managementName`/`searchName`에서
stripSuffix로 base 문자열을 추출해 `(productId, channelId, base)`를 키로 묶는
**계산된** 그룹이다.

이 접근은 PR #56·#60·#61·#62에서 정규식을 계속 수정하게 만든 근본 원인이고,
다음과 같은 사용자 영향을 낳는다:

1. 같은 baseManagementName으로 별도 채널상품을 두 번 등록하면 우연히 하나로 합쳐짐
2. 묶음 라벨/번들 수량/속성값을 stripSuffix로 떼는 로직이 listing 이름 형식 변경에
   취약 — 새 케이스마다 정규식이 깨질 위험
3. 채널상품 메타(`ProductChannelGroupMeta`)는 product×channel 단위라서 채널상품이
   여럿일 때 공유됨 → 의미 모순

**해결**: 채널상품을 DB 엔티티로 승격(`ProductListingGroup`). listing은 명시적
`groupId`로 채널상품에 귀속. stripSuffix·`computeListingGroupKey` 제거.

> **용어 정책**: 사용자에게 노출되는 레이블은 "채널상품" 또는 "판매채널 상품"을 사용.
> 코드 내부 타입명/모델명은 `ProductListingGroup`(기존 네이밍 유지)으로 통일.

---

## 1. 데이터 모델

### 신규: `ProductListingGroup` (채널상품)

```prisma
model ProductListingGroup {
  id        String @id @default(cuid())
  spaceId   String
  channelId String
  productId String  // 단일-product 채널상품만 지원 (혼합 listing은 채널상품 없이 단독)

  // 기본 정보 (채널상품 단위로 공유, 자식 listing의 이름은 base + suffix로 자동 구성)
  baseSearchName     String
  baseDisplayName    String?  // 비어있으면 baseSearchName 사용
  baseManagementName String?
  baseInternalCode   String?
  memo               String?

  // 채널상품 키워드 (기존 ProductChannelGroupMeta에서 이전)
  keywords Json @default("[]")

  space    Space            @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  channel  Channel          @relation(fields: [channelId], references: [id], onDelete: Cascade)
  product  InvProduct       @relation(fields: [productId], references: [id], onDelete: Cascade)
  listings ProductListing[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([spaceId, channelId])
  @@index([productId, channelId])
}
```

### 변경: `ProductListing.groupId` 추가

```prisma
model ProductListing {
  // ... 기존 필드 유지
  groupId String?  // null = 단일 listing(혼합 구성 등)
  group   ProductListingGroup? @relation(fields: [groupId], references: [id], onDelete: SetNull)

  @@index([groupId])
}
```

### 제거: `ProductChannelGroupMeta`

키워드는 새 `ProductListingGroup.keywords`로 이전. 단 마이그레이션 시 기존 메타의
keywords는 같은 product×channel의 모든 채널상품에 복사 (또는 null로 초기화 — 5번 항목 참조).

---

## 2. 등록·편집 흐름

### 신규 등록 (listing-create-form)

기존:

```
사용자 입력 → for each row: POST /api/sh/products/listings (개별)
→ 마지막에 router.push(getSellerHubListingGroupPath(productCtx.id, channelId, newGroupKey))
```

변경:

```
1. POST /api/sh/products/listings/groups
   { spaceId, productId, channelId, baseSearchName, baseDisplayName, ...,
     keywords, items: [{ suffixParts, retailPrice, channelAllocation, status,
                          items: [{ optionId, quantity, sortOrder }] }] }
   ↓ 트랜잭션 안에서 채널상품 생성 + 모든 listing을 group.id에 묶어 일괄 생성
2. response: { group: { id }, listings: [...] }
3. router.push(`/d/seller-ops/products/listings`)  ← 목록으로 이동 (사용자 요청)
```

### 채널상품 상세 페이지 (URL 변경)

| 기존                                                                     | 변경                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| `/d/seller-ops/products/listings/groups/[productId]/[channelId]?g=<key>` | `/d/seller-ops/products/listings/groups/[groupId]` |

`groupKey` 쿼리 파라미터 제거. URL이 더 깔끔하고 ambiguity 없음.

### 채널상품 상세 API

| 기존                                                                   | 변경                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /api/sh/products/listings/groups/[productId]/[channelId]?g=<key>` | `GET /api/sh/products/listings/groups/[groupId]` |
| `PATCH .../[productId]/[channelId]` (메타)                             | `PATCH .../[groupId]` (base 정보 + 메타 통합)    |

### 채널상품 목록 API

`GET /api/sh/products/listings/groups`:

- 기존: 모든 listing을 가져와서 `computeListingGroupKey`로 동적 채널상품 구성
- 변경: `prisma.productListingGroup.findMany({ include: { listings: { ... } } })`
  - `groupId IS NULL`인 listing은 `mixed` 또는 `solo`로 별도 표기

### listing 단건 편집

`PATCH /api/sh/products/listings/[listingId]` 는 그대로. `groupId`는 변경 못함
(이동은 별도 미지원 — 필요 시 추후 기능).

---

## 3. listing 이름 구성 규칙

기존: searchName이 `${base} ${suffixParts.join(' ')}` 형태로 저장됨.
변경: **그대로 유지**. listing 이름은 base + suffix로 사용자 표시용. 채널상품 정체성은
이름이 아니라 `groupId`로 결정되므로 stripSuffix 정규식이 더 이상 필요 없음.

`group-base-info-card.tsx`의 `joinName`/`buildSuffix`는 base 편집 시 자식 listing의
이름을 재구성하는 용도로 유지 (suffix 보존이 목적).
`stripSuffix`는 채널상품 키 추출용이므로 **제거**.
`deriveBaseValues`는 단일 채널상품 내에서 자식 listing들의 공통 base를 추론하는
용도로 유지 (자체 인스턴스 안에서만 동작하므로 안전).

---

## 4. 영향 받는 파일

### 스키마/마이그레이션

- `prisma/schema.prisma` — ProductListingGroup 추가, ProductListing.groupId 추가, ProductChannelGroupMeta 제거
- `prisma/migrations/<ts>_add_product_listing_group/migration.sql` — 백필 SQL 포함

### API

- `app/api/sh/products/listings/groups/route.ts` — GET 재작성 (실체 기반), POST 신설
- `app/api/sh/products/listings/groups/[productId]/[channelId]/route.ts` — **삭제**
- `app/api/sh/products/listings/groups/[groupId]/route.ts` — 신규 (GET/PATCH/DELETE)
- `app/api/sh/products/listings/route.ts` — POST 시 groupId 받기 (선택), 기존 single-listing 흐름 유지
- `app/api/sh/products/listings/[listingId]/route.ts` — 변화 없음

### 라우팅

- `app/d/seller-ops/products/listings/groups/[productId]/[channelId]/page.tsx` — **삭제**
- `app/d/seller-ops/products/listings/groups/[groupId]/page.tsx` — 신규
- `src/lib/deck-routes.ts` — `getSellerHubListingGroupPath(groupId)` 시그니처 변경

### 컴포넌트

- `src/components/sh/products/listings/listing-create-form.tsx` — POST 호출을 채널상품 단위로 변경, 성공 시 목록으로 이동
- `src/components/sh/products/listings/group-detail-view.tsx` — props를 groupId로 변경, fetch URL 변경
- `src/components/sh/products/listings/group-base-info-card.tsx` — stripSuffix 제거, deriveBaseValues 시그니처 단순화
- `src/components/sh/products/listings/groups-table.tsx` — GroupRow.id에 groupId 사용, URL 생성 변경
- `app/d/seller-ops/products/listings/[listingId]/page.tsx` — listing 단건 진입 시 groupId 있으면 채널상품으로 redirect
- `src/components/sh/products/listings/product-listings-panel.tsx` — 카운트가 listing 단위 → 채널상품 단위로

### 헬퍼/제거

- `src/lib/sh/group-key.ts` — **제거**
- `src/lib/sh/schemas.ts` — `productChannelGroupMetaSchema` 통합/이동

---

## 5. 데이터 마이그레이션 전략

### 백필 SQL (마이그레이션 안에 포함)

```sql
-- 1. 새 컬럼/테이블 추가 (DDL)
CREATE TABLE "ProductListingGroup" ( ... );
ALTER TABLE "ProductListing" ADD COLUMN "groupId" TEXT;

-- 2. 기존 listing들을 (productId, channelId, base) 단위로 묶어 채널상품 생성
--    base = 현재 stripSuffix 로직과 동일한 결과를 SQL로 재현하기 어려우므로,
--    더 단순한 규칙으로 시작: managementName(없으면 searchName)을 그대로 base로 사용.
--    동일 base인 listing은 한 채널상품.
WITH listing_groups AS (
  SELECT DISTINCT
    pl."productId" AS product_id,    -- (FK는 InvProductOption 경유라 직접 컬럼 없음 — 실제론 join 필요)
    pl."channelId" AS channel_id,
    COALESCE(pl."managementName", pl."searchName") AS base
  FROM "ProductListing" pl
  WHERE pl."groupId" IS NULL
)
INSERT INTO "ProductListingGroup" (id, "spaceId", "channelId", "productId",
  "baseSearchName", "baseManagementName", keywords, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, ...

-- 3. listing.groupId 채우기
UPDATE "ProductListing" pl SET "groupId" = g.id FROM ...

-- 4. ProductChannelGroupMeta.keywords를 채널상품으로 복사
UPDATE "ProductListingGroup" g SET keywords = m.keywords FROM
  "ProductChannelGroupMeta" m WHERE g."productId"=m."productId" AND g."channelId"=m."channelId";

-- 5. ProductChannelGroupMeta 삭제
DROP TABLE "ProductChannelGroupMeta";
```

**중요**: `productId`는 `ProductListing`에 직접 컬럼이 없고
`ProductListing.items[].option.productId`로 join이 필요. 단일-product listing만
채널상품 대상. 혼합 구성은 `groupId IS NULL` 유지.

마이그레이션은 dev에서 충분히 테스트 후 prod 적용. 운영은 `prisma migrate deploy`가
자동 실행하므로 SQL 멱등성 확보 필요(`IF NOT EXISTS` 등).

### 백필 위험

- 동일 baseManagementName으로 잘못 묶인 기존 채널상품은 백필 후에도 하나로 유지됨.
  사용자가 수동으로 "채널상품 분리" 기능을 쓰거나, 새 등록부터 분리됨.
- 묶음 라벨/번들 수량 suffix가 붙은 listing들은 백필 시 base가 달라져 별도 채널상품이 됨.
  이 경우 운영 데이터에서 사용자 경험이 달라질 수 있음 → **dev 적용 후 사용자 검토 필요**.

---

## 6. 단계별 구현 계획

### Phase B-1: 스키마·마이그레이션·백필 (PR 1)

- prisma schema 변경, 마이그레이션 SQL 작성
- dev DB 적용 후 데이터 검증
- 기존 코드는 그대로 두고 모델/관계만 추가 (양립 단계)

### Phase B-2: 등록·조회 API 전환 (PR 2)

- 신규 채널상품 POST, 채널상품 단위 GET 라우트 추가
- 기존 라우트는 deprecated 처리 (유지하되 사용 금지)
- 채널상품 목록 GET을 새 모델 기반으로 변경

### Phase B-3: 컴포넌트·라우팅 전환 (PR 3)

- groups-table, group-detail-view, listing-create-form을 새 API로 교체
- URL을 `/listings/groups/[groupId]`로 변경
- 기존 `/listings/groups/[productId]/[channelId]` 페이지는 redirect 처리
- 등록 완료 후 판매채널 상품 목록(`/d/seller-ops/products/listings`)으로 이동

### Phase B-4: 정리 (PR 4)

- `computeListingGroupKey` / `group-key.ts` 제거
- `ProductChannelGroupMeta` 모델 제거 (마이그레이션)
- deprecated API 라우트 삭제

---

## 7. 검증 시나리오

### 단위 테스트

- 채널상품 생성 트랜잭션 (채널상품 + listings 일괄 생성)
- listing 생성 시 groupId 검증 (해당 채널상품에 속하는지)
- 채널상품 삭제 시 자식 listing cascade 동작

### 통합 검증 (dev)

1. 같은 baseManagementName으로 채널상품 A 등록 → 채널상품 B 등록 → 두 채널상품이 독립적으로 유지됨
2. 채널상품 안에서 base 편집 → 자식 listing 이름 일괄 갱신
3. 묶음 listing 생성 → 한 채널상품으로 묶임 (이름 형식과 무관)
4. 백필 검증: 운영 데이터의 기존 채널상품이 의도대로 보존됨
5. 신규 등록 후 판매채널 상품 목록 페이지로 이동 확인

---

## 8. 미해결 사항 — 사용자 추가 의견 필요

1. **백필 base 추출**: 단순히 managementName 사용 vs 기존 stripSuffix 로직 한 번 더
   사용 (멱등 보장 어려움). **추천: 단순 managementName** — 기존 분리되어 있던 채널상품은
   그대로 분리, 합쳐져 있던 채널상품은 그대로 합쳐진 채로 보존.
2. **채널상품 분리/합치기 UI**: 백필 후 잘못 합쳐진 채널상품을 분리하는 기능 — 추후 별도 기능.
3. **단건 listing(groupId=null)** 케이스: 혼합 구성 + 단일 옵션 listing 직접 생성. 현재
   listing-form.tsx 단건 생성은 groupId 없이 가능하도록 유지.
