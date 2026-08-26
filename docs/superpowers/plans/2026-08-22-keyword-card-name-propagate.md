# 키워드 관리 화면에서 묶인 채널상품 상품명 편집 열기

## Context

`/d/seller-ops/products/keywords` 에서 **판매 옵션이 묶인 채널상품 카드의 상품명이 읽기전용**이라 사용자가 못 고친다. 직전 릴리스(#733)에서 내가 잠근 것이다.

잠근 이유는 실재하는 문제였다: 채널에 실제로 나가는 이름은 `ProductListing.searchName` 이고 `ChannelProduct.baseSearchName` 는 파생 원본이라, base 만 PATCH 하면 **"저장했습니다"는 뜨는데 채널 상품명은 안 바뀐다.** 조용히 실패하느니 잠그는 쪽을 택했다.

그때 "전파 로직을 재현하려면 `group-detail-view` 를 통째로 복제해야 한다"고 판단했는데, **그건 오판이었다.** 실제로 조사해 보니 계산 함수(`deriveBaseValues`·`buildSuffix`)는 이미 순수 함수고 React·prisma·fetch 의존이 없다. 재현 비용이 크지 않다.

목표: 카드에서 상품명을 고치면 자식 리스팅 이름까지 **옵션 접미사를 보존한 채** 실제로 바뀌게 한다.

## 조사에서 새로 드러난 별개 버그

`keyword-cards` 라우트의 혼합 판정이 **CP 단위가 아니라 listing 단위**다:

```ts
if (new Set(l.items.map((it) => it.option.productId)).size !== 1) continue
```

이건 "이 listing 자신이 여러 상품을 섞은 세트냐"만 본다. 반면 `channel-products/[id]` GET 의 `kind: 'mixed'` 는 "이 **CP 아래 모든 listing** 이 서로 다른 상품을 참조하냐"다 — 범위가 다르다.

게다가 `where` 가 `items: { some: { option: { productId } } }` 라서, 상품 P 를 보는 중에 CP 가 L1(상품 P)+L2(상품 Q)를 갖고 있으면 **L1 만 잡히고 카드는 "단일 상품"처럼 보인다.** 실제로는 mixed CP 인데 카드가 그걸 모른다. 화면의 `판매 옵션 N개` 도 CP 전체 자식 수가 아니라 이 상품에 걸친 수만 센다.

이걸 안 고치면 이름 편집을 여는 순간 **mixed CP 에 잘못된 전파를 시도하게 된다.** 지금은 전부 잠겨 있어 드러나지 않았을 뿐이다.

## 접근: 서버 전파 + opt-in 플래그

클라이언트가 리스팅마다 PATCH 를 쏘는 대신, `PATCH /api/sh/products/listings/channel-products/[id]` 가 자식 리스팅 이름까지 **한 트랜잭션 안에서** 갱신한다.

- **원자성** — 리스팅 N개 + CP 1개 + 이력 1건을 `$transaction` 으로 묶을 수 있는 건 서버뿐이다. 기존 `group-detail-view` 는 리스팅 N번 → CP 1번을 트랜잭션 없이 보내서, 중간 실패 시 어긋난 채 남는다. 새 경로에 그 문제를 이식하지 않는다.
- **페이로드** — `keyword-cards` 는 목록 응답이다. 자식 리스팅 배열 + `optionAttributes` 를 실으면 카드 10개짜리 상품에서 리스팅 수십 개가 목록 API 에 얹힌다.
- **회귀 차단** — `group-detail-view` 는 새 플래그를 절대 안 보낸다. 서버에서 "플래그 없으면 기존 경로 그대로"를 유지하면 기존 화면 동작은 바이트 단위로 동일하다.

## 반드시 보존할 계산 디테일

기존 화면(`group-detail-view.tsx:846-893`)의 `tail()` 클로저를 그대로 추출한다. **임의로 "정리"하면 두 화면 계산이 서서히 어긋난다.**

- `tail = name.slice(oldBase.length)` — 선행 공백 포함한 채로 뗀다
- 접두어 매칭 실패 시 폴백은 `' ' + buildSuffix(...)` (앞 공백 하나)
- 최종값 `(newBase.trim() + tail).trim()`, 그것도 비면 `|| l.searchName` 로 원래 이름 유지
- displayName 의 old base 는 `derivedBase.baseDisplayName || derivedBase.baseSearchName`
- **`oldBase` 는 `cp.baseSearchName` 컬럼이 아니라 `deriveBaseValues(listings, attrs)` 로 리스팅에서 역산한 값**이다. 컬럼값을 쓰면 CP 와 자식이 이미 어긋난 케이스에서 결과가 달라진다

## 범위에서 빼는 것

- **`managementName`·`internalCode`·`memo` 는 전파하지 않는다.** 기존 화면은 같이 전파하지만 새 카드엔 그 입력 UI 가 없다. 특히 `memo` 는 기존 화면이 tail 없이 통째로 덮어쓴다 — 화면에 안 보이는 필드가 조용히 사라지면 안 된다. 라우트에 이유를 주석으로 남긴다.
- **mixed CP 는 계속 잠근다.** `deriveBaseValues`/`buildSuffix` 가 단일 `attrs` 하나만 받는 시그니처라 계산 자체가 불가능하다. 서로 다른 상품을 묶은 CP 는 기존 화면에서 편집한다.
- 스키마 변경 없음. `propagateNames` 는 요청 본문 전용 필드다.

---

## Task 1 — 계산 로직을 `src/lib/sh/` 로 이관

**파일**

- 신설 `src/lib/sh/listing-name-propagation.ts`
- `src/components/sh/products/listings/group-base-info-card.tsx` (함수 제거)
- `src/components/sh/products/listings/group-detail-view.tsx` (import 경로 + 인라인 `tail()` 를 새 함수 호출로 교체)
- `src/components/sh/products/listings/listing-create-form.tsx:42` (import 경로만)

`buildSuffix`·`joinName`·`stripSuffix`(현재 비-export, `deriveBaseValues` 내부 의존)·`deriveBaseValues`·`GroupListingForBase`·`OptionAttribute` 를 옮기고, `group-detail-view` 의 `tail()` 산술을 `applyBaseRename` 으로 추출한다.

라우트 핸들러가 `'use client'` .tsx 를 import 하면 `@/components/ui/*`·lucide·sonner 가 서버 번들 그래프에 끌려온다. re-export 는 남기지 않는다 — 소비처가 2곳뿐이라 직접 이관이 더 명확하고, 구 파일을 계속 import 하는 실수를 원천 차단한다.

**확인** `npx tsc --noEmit` 통과. 기존 group-detail 저장 동작 무변.

## Task 2 — characterization 테스트 (Task 1 직후, 리와이어 전)

**파일** 신설 `src/lib/sh/__tests__/listing-name-propagation.test.ts`

지금 동작을 **먼저 고정**하고 나서 `doSave` 가 새 함수를 부르도록 바꾼다. 케이스:

- 접두어 정상 매칭 / 불일치 → `buildSuffix` 폴백
- tail 이 빈 문자열(리스팅 이름 == base)
- 번들 아이템끼리 옵션값이 달라 `buildSuffix` 가 그 속성을 제외하는 경우
- `stripSuffix` 의 두 정규식(` #N`, ` N개`) 라운드트립
- `deriveBaseValues` 의 `baseDisplayName: ''` 분기
- newBase 가 빈 문자열 → `|| l.searchName` 폴백
- `inconsistentBases` 채워지는 경우

**확인** `npx jest src/lib/sh/__tests__/listing-name-propagation.test.ts` 그린.

## Task 3 — `keyword-cards` 혼합 판정을 CP 전체 기준으로 교정

**파일** `app/api/sh/products/[productId]/keyword-cards/route.ts`

CP 를 모은 뒤 그 CP id 들의 **전체 자식** listing→item→`option.productId` 를 다시 조회해 진짜 `productIds.size` 를 구한다. 응답에 `nameEditable: boolean` 추가하고 `listingCount` 를 CP 전체 자식 수로 교정한다. `option.deletedAt: null` 필터를 PATCH 라우트와 맞춘다(GET 라우트의 include 에는 이 필터가 없다 — 둘이 다르다).

**확인** 두 상품이 섞인 CP 를 양쪽 상품 페이지에서 보면 둘 다 `nameEditable: false`. `판매 옵션 N개` 가 CP 실제 자식 수와 일치.

## Task 4 — CP PATCH 에 `propagateNames` opt-in 전파

**파일** `app/api/sh/products/listings/channel-products/[id]/route.ts`

- `patchSchema` 에 `propagateNames: z.boolean().optional()`
- 서버에서 mixed 재검증. **플래그가 true 인데 CP 가 mixed 면 400** — 조용히 스킵하면 원래 버그를 플래그만 씌워 재현하는 것이다
- 기존 `$transaction`(:333) 안에서 `deriveBaseValues` 로 old base 역산 → 자식마다 `applyBaseRename` 계산 → **값이 실제로 달라진 리스팅만** `tx.productListing.update`(불필요한 `updatedAt` 갱신 방지)
- `KeywordChangeLog` 는 **base 기준 1건만**. 이미 있는 로그 코드를 그대로 쓴다. 자식 갱신은 listing PATCH 라우트를 거치지 않으므로 두 번째 로그가 생길 경로 자체가 없다
- `absorbKeywords` 는 지금처럼 트랜잭션 **밖**, 커밋 후 유지
- 자식이 수십 개면 Prisma 기본 5초 타임아웃에 걸린다. 레포에 `{ timeout: 30000, maxWait: 10000 }` 선례가 있다(`app/api/finance/staging/commit/route.ts:226`) — 같은 방식으로 명시

**확인** `propagateNames: true` 로 이름을 바꾸면 자식 `searchName`/`displayName` 이 실제로 바뀐다. 플래그 없이 보내는 기존 요청은 이전과 동일.

## Task 5 — 카드 잠금 해제

**파일** `src/components/sh/products/keywords/product-keyword-card.tsx`

- `nameLocked` 를 `readOnly || !card.nameEditable` 로 재정의
- 게이트 무력화 되돌리기: `diff` 계산의 `card.kind === 'channelProduct' ? card.searchName : searchName` 삼항 제거, `dirty` 의 `!nameLocked &&` 가드 제거 → 이름 변경이 §25-26 게이트에 정상적으로 걸린다
- 저장 body(편집 가능할 때): `{ baseSearchName, baseDisplayName: displayName.trim() || null, propagateNames: true, keywords, ...changeMeta }`
- `nameEditable: false` 카드는 기존 안내 문구 + 링크 유지
- **`판매 옵션 N개` 표시가 이제 더 중요하다** — 이름 하나를 바꾸면 N개 리스팅 이름이 함께 바뀐다는 사실을 카드가 미리 알려야 한다. 편집 가능한 카드의 안내 문구를 그 사실로 교체

**확인** 카드에서 상품명 변경 → 사유 입력 → 저장 → `판매채널 상품` 화면에서 각 옵션 이름이 `새 이름 + 기존 옵션 접미사` 로 바뀌어 있다.

---

## 검증

1. `npx jest` 전체 (현재 898건, 줄면 안 됨) / `npm run lint` 0 errors / `npm run build`
2. **회귀** — 기존 `판매채널 상품 > 그룹 상세` 화면에서 base 이름을 바꿔 저장 → 자식 옵션 이름이 예전과 똑같이 바뀌는지
3. **신규** — 키워드 관리에서 옵션이 묶인 카드의 상품명 변경 → 사유 입력 → 저장 → F5 후 유지, 그룹 상세 화면에서 각 옵션 이름 확인
4. **mixed 잠금** — 서로 다른 상품을 묶은 CP 카드가 여전히 잠겨 있고 링크가 뜨는지
5. **접미사 보존** — 옵션 접미사(색상/사이즈 등)가 붙은 리스팅에서 접미사가 살아남는지
6. 릴리스: 브랜치 → develop → 검증 → release PR → main
