# 키워드·상품명 관리 사용성 개편 설계

> 대상 deck: seller-hub (`/d/seller-ops`)
> 배경 문서: `docs/decks/seller-hub/guides/쿠팡 상품명 및 검색어 운영 가이드.md`
> 선행 구현: PR #722·#723·#725 (main 릴리스 완료)

## 왜 고치는가

키워드 관리 기능을 prod에 올린 뒤 사용성이 나쁘다는 피드백을 받았다. 코드를 대조한 결과, 구현이 실제 업무 흐름과 **축이 어긋나** 있었다.

사용자의 실제 흐름은 이렇다.

1. 상품 목록에서 상품을 등록하고 기본 정보를 채운다
2. 그 상품으로 판매채널 상품을 만들며 **상품명(검색용)·상품명(노출용)·키워드**를 정한다 — 이때 입력이 적합한지 검토받고 개선점을 제안받고 싶다
3. 키워드 관리 화면에서 **상품 하나가 각 채널에서 어떤 이름·키워드로 팔리는지** 한번에 보고 고치고 싶다

구현은 이렇게 돼 있었다.

| 기대                      | 실제                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 상품명 적합성 검토        | 입력란 옆에 **글자수만**. `validateProductName`의 위반 목록은 `keyword-editor.tsx:92`에서 계산 후 **버려짐** |
| 노출용 상품명 검토        | **검증 없음** — `validateListingNaming`이 `searchName`만 받음                                                |
| 개선점 제안               | 등록/수정 폼에 없음. 원클릭 수정은 SOP 위저드에만, 편집 모드 링크로만 진입(생성 폼엔 진입점 없음)            |
| 키워드 관리 1행 = 상품    | **1행 = 키워드**                                                                                             |
| 상품 고르면 채널별 상품명 | 상품 필터를 걸어도 키워드 목록. 채널명은 칩 툴팁에만                                                         |

근본 원인은 가이드 §24 "Keyword Master" 표를 **문서의 구조 그대로 화면 구조로 옮긴 것**이다. 문서는 키워드를 행으로 나열하지만, 사람은 상품을 들고 일한다.

부수 증거: prod의 `KeywordMaster`는 **0행**이다. 추천 칩이 마스터에 의존하는데 마스터를 채울 동기가 없는 닭-달걀이라, 실사용에서 아무 도움을 못 준다.

---

## 확정된 방향

| 항목             | 결정                                                          |
| ---------------- | ------------------------------------------------------------- |
| 키워드 관리 화면 | **상품 축으로 전면 교체** (2-pane)                            |
| KeywordMaster    | **유지 + 자동 축적** (단방향)                                 |
| 제안 수준        | **결정론적 + AI 병행** — 검증·수정은 결정론적, 초안 생성만 AI |
| 길이 기준        | **채널 기준을 단일 진실로**                                   |

---

## D1 재정의 — "동기화 없음" → "단방향 축적"

원설계(D1)는 `ProductListing.keywords`(채널 등록 검색어, 권위)와 `KeywordMaster`(후보 풀)를 완전히 분리했다. 그 결과가 0행이다.

바꾸되 **단방향 축적**으로 한정한다.

- 리스팅 저장 시 → 각 키워드를 `KeywordMaster`에 upsert (`status=SEARCH_TERM`, `source=INTERNAL`) + `KeywordMasterLink` 생성
- **역방향 전파 없음**: 마스터를 고쳐도 리스팅이 바뀌지 않는다
- **삭제 전파 없음**: 리스팅에서 키워드를 빼도 마스터에서 지우지 않는다

삭제를 전파하면 사전에서 단어가 사라져 중복 탐지 이력과 금지어 표시가 무너진다. 마스터는 "이 space가 지금까지 써 본 표현의 사전"이지 "현재 채널에 걸린 것의 거울"이 아니다.

`prisma/schema.prisma`의 `KeywordMaster` 주석("동기화하지 않는다")을 이 정의로 고친다.

---

## Phase 1 — 폼 검증 노출 수정

**가장 먼저 한다.** 사용자가 매일 쓰는 화면이고, 위반은 이미 계산되는데 화면에서 버려지고 있어 투입 대비 효과가 가장 크다.

### 1-1. 상품명 위반을 입력란 옆에 표시

`keyword-editor.tsx:87-92`의 판단을 뒤집는다. 현재 주석은 *"상품명 자체의 위반은 이 화면에서 고칠 수 없으므로"*라고 적혀 있지만, **상품명 입력란이 바로 그 화면에 있다.** 사실과 다르다.

- 위반 표시는 `KeywordEditor` 안이 아니라 **각 상품명 입력란 바로 아래**로 옮긴다. 키워드 위반과 상품명 위반이 한 배지에 섞이면 무엇을 고쳐야 할지 알 수 없다.
- 신규 컴포넌트 `name-validation-panel.tsx` — 입력란 하나에 대응. 길이 게이지 + 위반 목록 + 원클릭 수정.
- 원클릭 수정은 **이미 구현돼 있다**: `steps/step-05-clean-name.tsx:104-124`의 `fixFor`(`removeRepeatedToken`·`removeTerm`·`removeDecorativeChars`). 이 로직을 `src/lib/sh/keyword-fix.ts`로 추출해 SOP 위저드와 폼이 공유한다.

### 1-2. 노출용 상품명 검증 추가

`validateListingNaming`의 입력을 확장한다.

```ts
validateListingNaming(input: {
  searchName: string
  displayName?: string   // 신규 — 있으면 함께 검증
  keywords: string[]
  categoryNames?: string[]
  optionNames?: string[]
  rules: KeywordRuleSet
}): {
  searchName: NameValidationResult
  displayName: NameValidationResult | null   // 신규
  keywords: KeywordValidationResult
  hasError: boolean
}
```

⚠️ 반환 형태가 바뀐다(`name` → `searchName`). 호출부는 `src/lib/sh/keyword-warnings.ts:20`과 `app/api/sh/keywords/validate/route.ts:27` 두 곳 + 테스트다. 후자는 **공개 API 응답 형태**라 소비자가 있으면 함께 깨진다 — 현재 이 라우트를 호출하는 클라이언트 코드는 없으므로(저장 전 프리뷰용으로 만들어 뒀으나 미사용) 지금 바꾸는 게 비용이 가장 싸다.

**검색어 중복 판정은 `searchName` 기준을 유지한다.** 가이드 §10 Rule 1의 대상은 검색에 쓰이는 이름이다. `displayName`은 길이·금지어·특수문자만 본다.

### 1-3. 죽은 `namingWarnings` 살리기

서버는 저장 응답에 `namingWarnings`를 실어 보내는데(`keyword-warnings.ts`) **두 폼 다 읽지 않는다**. 저장 후 toast는 고정 문구다.

클라이언트가 실시간 검증을 하므로 서버 경고는 중복이다. 둘 중 하나를 고른다.

- **채택**: 저장 성공 toast에 위반 요약을 덧붙인다(`"저장했습니다 · 상품명 규칙 위반 2건"`). 서버가 최종 판정자이므로, 클라이언트 검증을 우회한 경로(API 직접 호출·구버전 화면)에서도 사용자가 알 수 있다.
- 기각: `buildNamingWarnings` 제거. 서버 판정이 사라져 API 소비자가 규칙을 모른 채 저장하게 된다.

### 1-4. 생성 폼에 SOP 진입점 추가

`getSellerHubNamingSopPath`가 `listing-form.tsx`(편집 모드)에만 있다. 신규 등록이야말로 SOP가 필요한 시점이다. `listing-create-form.tsx`에도 링크를 넣는다.

### 검증

- `keyword-fix.ts` 단위 테스트(추출 시 동작 불변 확인)
- `validateListingNaming` 반환 형태 변경에 대한 테스트 갱신
- 폼에서 40자 미만·120자 초과·"무료배송 특가"·특수문자 각각 위반 표시 + 원클릭 수정 동작

---

## Phase 2 — 길이 기준 통합

지금 한 화면에 **세 가지 기준**이 동시에 뜬다.

| 출처                                | 값                               | 표시 위치               |
| ----------------------------------- | -------------------------------- | ----------------------- |
| `channel-name-limits.ts` (하드코딩) | 쿠팡 100 / 무신사 30 / 29CM 40 … | 입력란 옆 `NameCounter` |
| `keyword-rules.ts` (가이드 §7)      | 목표 40~70, 권장 80, 절대 120    | KeywordEditor 요약      |
| `MAX_NAME_LENGTH` / Zod             | 200                              | Input `maxLength`       |

무신사 리스팅에서 카운터는 "30자 상한", 같은 화면 요약은 "목표 40~70자"라고 한다. **사용자에게 상반된 지시가 동시에 뜬다.**

### 해소

`channel-name-limits.ts`를 폐기하고 그 값을 `keyword-rules.ts`의 **채널 기본값 맵**으로 흡수한다. `ChannelKeywordRule`(DB) 오버라이드가 그 위에 얹힌다 — 기존 D6("행이 없으면 기본값, 시드 없음")는 그대로 유지된다.

```ts
// keyword-rules.ts
// 채널 식별은 Channel.externalSource(연동) → name 부분일치(수동) 순서.
export function resolveKeywordRules(
  channel: { name: string; externalSource: string | null } | null,
  override: KeywordRuleOverride | null
): KeywordRuleSet
```

채널 상한에서 목표 구간을 파생한다. 채널마다 상한이 다른데 목표를 40~70으로 고정하면 짧은 채널에서 모순이 생긴다.

```
nameHardMax   = 채널 상한 (쿠팡은 가이드 §7의 120)
nameSoftMax   = min(80, hardMax)
nameTargetMax = min(70, hardMax)
nameTargetMin = min(40, floor(hardMax * 0.6))
```

무신사(30) → 목표 18~30, 권장상한 30, 절대 30. 모순이 사라진다.

⚠️ **상한은 검색용·노출용이 따로다.** 무신사는 검색용 30 / 노출용 40으로 다르다. 따라서 규칙셋에 `channelLimits: { searchName?: number; displayName?: number }`를 싣고, 검증 시 필드별로 파생한다.

```ts
export type NameField = 'searchName' | 'displayName'
/** 필드 상한으로 name* 값을 다시 파생한 규칙셋을 돌려준다. 상한이 없으면 원본 그대로. */
export function rulesForNameField(rules: KeywordRuleSet, field: NameField): KeywordRuleSet
```

기존 평면 필드(`nameTargetMin` 등)는 그대로 두어 현 소비자를 깨지 않는다 — 검색용 기준값으로 유지한다.

**쿠팡은 가이드 값을 쓴다**(40/70/80/120). `channel-name-limits.ts`의 100은 출처가 없는 값이라 버린다.

`NameCounter`는 세 곳(`listing-form`·`listing-create-form`·`group-base-info-card`)에 중복 정의돼 있다. 공용 컴포넌트로 합치고 `KeywordRuleSet`을 받게 한다.

### 검증

- 쿠팡·무신사·미등록 채널 각각의 파생값 테스트
- 한 화면에 기준이 하나만 보이는지 육안 확인

---

## Phase 3 — 마스터 자동 축적 (✅ 구현 완료 — 2026-08-21)

Phase 4가 의미를 가지려면 데이터가 있어야 한다.

- `POST /api/sh/products/listings`, `PATCH .../[listingId]`, `PATCH .../channel-products/[id]`에서 저장 성공 후 키워드를 마스터로 흡수
- 흡수 로직은 `src/lib/sh/keyword-absorb.ts` — 라우트 3곳이 공유
- `KeywordMasterLink`는 리스팅 단위(`listingId`)로 건다. 상품 단위(`productId`) 링크는 구성 옵션이 한 상품일 때만 추가로 건다(`resolveBaseProduct` 재사용)
- **실패해도 저장을 되돌리지 않는다.** 흡수는 부가 기능이고, 이것 때문에 저장이 실패하면 안 된다. 실패는 로깅만.

### 구현하며 달라진 것

- **링크는 설계대로 두 행이다**(`{productId, null}` + `{null, listingId}`). 구현 중에 "한 행에 둘 다 담으면 쓰기량이 절반"이라고 판단해 합쳤다가 되돌렸다. 합치면 안 되는 이유 둘: ① 리스팅이 하나뿐인 상품에서 그 리스팅을 지우면 `onDelete: Cascade` 로 링크가 사라지고 상품 귀속을 되살릴 경로가 없다(영구 손실). ② `keyword-master-view.tsx` 의 `linkChipInfo` 가 `listingId != null` 을 먼저 분기해서, 합친 행은 **살아 있는 동안에도** 상품 칩이 표시되지 않는다. 쓰기 1회를 아끼고 무손실도 두 축 표시도 얻지 못한다.
- **`PATCH .../channel-products/[id]` 는 `productId` 만 건다**(`listingId: null`). 채널상품 키워드는 정의상 상품 단위이고, 자식 리스팅으로 팬아웃하면 쓰기량이 리스팅 수만큼 늘어난다.
- **삭제 전파 없음은 링크에도 적용한다.** 리스팅에서 키워드를 빼도 마스터 행은 물론 링크도 지우지 않는다. 흡수는 자기가 만든 링크와 사용자가 수동으로 만든 링크를 구별할 수 없어서, 무관한 저장 한 번이 수동 연결을 지우는 쪽이 더 나쁘다.
- **흡수 행은 `source: INTERNAL` / `status: SEARCH_TERM`.** 채널에 실제 등록된 검색어이므로 미검증 후보(`CANDIDATE`)가 아니다.
- **조회·생성·링크 전부 배치.** 키워드마다 findFirst+create 를 돌면 30개에 60회 왕복인데, 이 호출이 저장 응답 앞에 있어 사용자가 그 지연을 그대로 기다린다. `findMany` + `createMany(skipDuplicates)` 조합으로 왕복을 상수로 만들었다. **기존 링크는 건드리지 않는다** — 사용자가 MAIN 으로 올려둔 링크를 저장 한 번이 SUB 로 되돌리면 안 된다.
- **`createKeywords`(`src/components/sh/products/keywords/create-keywords.ts`)를 재사용하지 않았다.** 그건 `fetch('/api/sh/keywords')` 를 쓰는 클라이언트 헬퍼라, 라우트가 자기 HTTP 엔드포인트를 부르면 쿠키·인증 전파에서 깨진다.

기존 `RegisterKeywordsButton`(수동 등록)은 남긴다 — 자동 흡수는 저장 시점에만 일어나므로, 저장 없이 사전에만 넣고 싶을 때 필요하다.

### 검증

- 리스팅 저장 → 마스터 행·링크 생성 확인
- 같은 키워드 재저장 → 중복 생성 없음(409 경로)
- 리스팅에서 키워드 삭제 → **마스터에 남아 있는지** 확인(삭제 전파 없음)

---

## Phase 4 — 상품 축 2-pane 화면 (✅ 구현 완료 — 2026-08-21)

`/d/seller-ops/products/keywords`를 상품 축으로 교체한다. 레포에 이미 `ListingsTwoPane` 패턴이 있어 관례를 따른다.

### 구조

**좌: 상품 목록** — 상품명(`internalName ?? name`) / 브랜드 / 채널 수. 검색·브랜드 필터.

**우: 선택 상품의 채널별 편집** — 채널마다 카드 하나.

| 표시           | 내용                                           |
| -------------- | ---------------------------------------------- |
| 채널명         | 연동 채널이면 자물쇠(읽기전용 미러)            |
| 상품명(검색용) | 인라인 편집 + 길이 게이지 + 위반 + 원클릭 수정 |
| 상품명(노출용) | 동일                                           |
| 키워드         | `KeywordEditor` 재사용                         |
| 위반 요약      | 채널 규칙 기준                                 |

**여기서 바로 저장한다.** 리스팅 폼으로 튕겨 보내면 "한번에 관리하는 공간"이 아니게 된다. 저장은 기존 `PATCH /api/sh/products/listings/[listingId]`를 쓴다 — 변경 이력 게이트(Phase 4 기존 구현)도 그대로 태운다.

키워드 사전(현재 키워드 축 화면)은 **탭으로 강등**한다. 중복 탐지·금지어 관리는 여전히 필요하다.

### API

신규 `GET /api/sh/products/keyword-overview` — 좌측 목록용. 상품 + 채널 수.

기존 `GET /api/sh/products/[productId]/listings`를 확장 — 응답에 `keywords`를 추가(현재 `searchName`/`displayName`은 있는데 `keywords`가 없다). **additive 변경**이라 기존 소비자(`ProductListingsPanel`)에 영향 없다.

### 구현하며 달라진 것

- **카드 단위는 채널이 아니라 "채널상 노출 단위"다.** `channelProductId` 가 있으면 `ChannelProduct` 단위(저장 = `PATCH .../channel-products/[id]`, base 상품명을 공유하는 리스팅들을 카드 하나로 접는다), 없으면 단독 리스팅 단위(저장 = `PATCH .../listings/[listingId]`). 카드 종류는 서버가 정해서 내려주고 UI 는 분기만 한다.
- **API 는 기존 라우트 확장 대신 전용 라우트 2개.** 위 설계는 `GET .../[productId]/listings` 확장을 적었지만, 카드가 필요로 하는 건 ChannelProduct 그룹핑 + base 상품명이라 기존 응답 형태와 다르다. 기존 소비자(`ProductListingsPanel`) 페이로드를 부풀리지 않으려고 `GET /api/sh/products/keyword-overview` 와 `GET /api/sh/products/[productId]/keyword-cards` 를 새로 만들었다.
- **혼합 세트 리스팅은 양쪽에서 똑같이 뺀다.** 여러 상품이 섞인 리스팅은 특정 상품의 상품명이라 말할 수 없다. 좌측 "채널 N개" 집계도 같은 기준을 쓴다 — 한쪽만 빼면 좌측 숫자와 우측 카드 수가 어긋난다. 부작용: 혼합 세트에만 들어간 상품은 목록에 뜨지만 카드가 0개다. 그래서 빈 상태 문구를 `이 상품만으로 구성된 판매채널 상품이 없습니다` 로 쓴다 — "판매채널이 없습니다"는 거짓말이다.
- **변경 사유 게이트는 `diffKeywordChange` 로 판정한다.** 서버가 `KeywordChangeLog` 를 남기는 조건과 같은 함수를 쓴다. 노출용 상품명은 그 함수가 보지 않으므로 게이트 대상이 아니다 — 여기서만 사유를 요구하면 받은 사유가 저장되지 않고 버려진다. 대신 저장 버튼 라벨을 사유가 필요할 때 `변경 사유 입력 후 저장` 으로 바꿔, 눌렀더니 다이얼로그가 튀어나오는 놀람을 없앤다.
- **채널 카드의 상품명 편집은 서버가 자식 리스팅까지 전파한다** (2026-08-22 추가, `feat/sh-keyword-card-name-propagate`). 채널에 실제로 나가는 이름은 `ProductListing.searchName` 이고 `ChannelProduct.baseSearchName` 는 그 파생의 원본이다. base 만 바꾸면 저장은 되는데 채널 상품명이 안 바뀐다.
  - 최초 릴리스에서는 "전파 로직이 `group-detail-view` 에 얹혀 있어 재현하려면 그 화면을 통째로 복제해야 한다"고 판단해 **상품명을 잠갔다. 그 판단은 틀렸다** — 계산 함수(`deriveBaseValues`·`buildSuffix`)는 이미 순수 함수였고 React·prisma·fetch 의존이 없었다.
  - 지금은 `src/lib/sh/listing-name-propagation.ts` 로 추출해 **두 화면이 같은 함수를 쓴다**(`applyBaseRename`). 서버가 재구현했으면 두 화면 계산이 서서히 어긋났을 것이다.
  - 전파는 `PATCH .../channel-products/[id]` 의 **opt-in 플래그 `propagateNames`** 로만 켜진다. 기존 `group-detail-view` 는 자기가 리스팅을 따로 PATCH 하므로 플래그를 안 보낸다 — 서버가 또 전파하면 이중 쓰기가 된다.
  - CP·자식 리스팅·이력을 **한 트랜잭션**으로 커밋한다. 기존 화면은 리스팅 N번 → CP 1번을 트랜잭션 없이 보내서 중간 실패 시 어긋난 채 남는다 — 그 문제를 새 경로에 이식하지 않았다.
  - **`old base` 는 `cp.baseSearchName` 컬럼이 아니라 `deriveBaseValues(자식리스팅, attrs)` 역산값이다.** 컬럼을 쓰면 CP 와 자식이 이미 어긋난 케이스에서 기존 화면과 계산이 갈린다.
  - 전파 대상은 `searchName`·`displayName` 둘뿐. `managementName`·`internalCode`·`memo` 는 건드리지 않는다 — 새 카드에 그 입력 UI 가 없고, 특히 memo 는 기존 화면이 tail 없이 통째로 덮어써서 화면에 안 보이는 필드가 조용히 사라진다.
  - **여러 상품이 섞인 CP 는 여전히 잠긴다.** `deriveBaseValues`/`buildSuffix` 가 단일 `attrs` 하나만 받는 시그니처라 계산 자체가 불가능하다. 그런 CP 에 `propagateNames: true` 가 오면 서버가 400 으로 거절한다 — 조용히 스킵하면 원래 버그를 플래그만 씌워 재현하는 것이다.
- **`keyword-cards` 의 혼합 판정은 CP 전체 기준이다.** 처음에는 listing 단위(`이 listing 이 여러 상품을 섞었나`)로 봤는데, 그건 `channel-products/[id]` GET 의 `kind: 'mixed'`(`CP 아래 모든 listing 이 서로 다른 상품을 참조하나`)와 범위가 다르다. 게다가 `where` 가 현재 상품에 걸린 listing 만 잡아서, 상품 P 를 보는 중에 CP 가 P·Q 를 함께 갖고 있으면 카드가 "단일 상품"으로 보였다. 이름 편집을 열기 전에는 전부 잠겨 있어 드러나지 않았을 뿐이다. `nameEditable` 과 `listingCount` 둘 다 CP 전체 자식 기준으로 계산한다.
- **저장 body 에는 바뀐 필드만 담는다.** 빈 노출용 상품명은 `''` 가 아니라 `null` 로 보낸다(기존 화면과 같은 관례). 안 그러면 "설정 안 함"과 "빈 문자열"의 구분이 새 화면 저장 한 번에 사라진다.
- **자동저장 없음.** 게이트가 걸리는 필드라 자동저장과 섞으면 "저장이 안 된다"는 오해가 난다(앞선 릴리스에서 실제로 그 혼란이 있었다).
- **`KeywordEditor` 에 `readOnly` 를 추가했다.** 연동 채널 카드에서 칩 삭제·입력·"규칙 위반 정리"가 살아 있으면, 지운 칩이 저장도 안 되고 새로고침하면 되살아나는 거짓 어포던스가 된다. 삭제 버튼은 `disabled` 가 아니라 **미렌더** — 회색 X 는 "지울 수 있는데 막혔다"로 읽힌다. 위반 배지·글자수 표시는 남긴다(읽기전용은 "안 보인다"가 아니라 "못 바꾼다"다).
- **사전 탭은 첫 방문 전까지 마운트하지 않는다.** 상품 탭은 `forceMount` 로 항상 살려 둔다 — 편집 중에 탭을 옮겼다 오면 저장 안 한 내용이 경고 없이 사라지기 때문. 사전 탭까지 무조건 `forceMount` 하면 페이지 진입만으로 사전 목록 조회가 같이 나가므로, 한 번 열린 뒤부터 유지한다.
- **검색으로 목록이 바뀌어도 선택은 유지한다.** 검색어마다 선택을 첫 결과로 옮기면 타이핑 한 글자마다 우측 패널이 갈아엎어지고 편집 중이던 내용이 날아간다 — 좌측 하이라이트가 잠깐 안 보이는 것보다 훨씬 나쁘다.

### 의도적 제외

좌측 목록에 **위반 배지를 넣지 않는다.** 모든 상품의 모든 리스팅에 대해 위반을 미리 계산해야 하는데, 첫 화면 로딩에 그 비용을 치를 만한 근거가 아직 없다. 선택한 상품만 우측에서 계산한다. 필요해지면 그때 추가한다.

### 검증

- 상품 선택 → 채널별 상품명·키워드 표시
- 인라인 저장 → 변경 이력 기록 확인
- 연동 채널 카드가 읽기전용인지 확인
- 묶인 채널상품 카드에서 상품명이 읽기전용이고 편집 링크가 뜨는지 확인
- 저장 후 그 카드가 "변경됨" 상태로 남지 않는지 확인(재조회가 새 값을 내려주는지)

### 후속으로 남긴 것

- ~~상품 축 화면은 `KeywordMaster` 를 읽지 않는다~~ → **해소(2026-08-24).** 조사해 보니 공백이 더 넓었다 — `GET /api/sh/keywords/suggest` 는 Phase 2 에 완성돼 있었으나 **레포 전체에서 아무도 호출하지 않았고**, 기존 3개 화면(`listing-form`·`listing-create-form`·`group-detail-view`)도 전부 `masterPool: []` 로 호출하고 있었다. Phase 1 이 잘못된 추천을 끄면서 "Phase 2 에서 마스터 풀로 복귀한다"고 적었는데 그 복귀가 안 된 것이다. 네 화면 모두 `?productId=` 로 연결했다.
  - 상품 축 화면은 **패널에서 한 번만** 조회해 카드들에 내린다(카드 수와 무관하게 상품당 2요청). 카드는 자기 키워드를 `normalizeKeyword` 기준으로 걸러 넘기고, 연동 채널 카드에는 아예 넘기지 않는다
  - 여러 상품이 섞인 구성(`linkProduct === null` / `kind !== 'single'` / `productCtx === null`)에서는 **조회하지 않고 빈 배열로 초기화**한다 — 어느 상품의 추천인지 말할 수 없고, 초기화를 빼먹으면 이전 상품의 추천이 남는다
  - 조회 실패는 조용히 무시한다(토스트 없음). 추천은 부가 기능이고 저장 화면에 에러가 뜨면 안 된다
- ~~`keyword-overview` 의 리스팅 팬아웃에 상한이 없다~~ → **해소(2026-08-24).** 집계를 `$queryRaw` GROUP BY 로 DB 에 내렸다. 응답은 상품당 1행(페이지 상한 30행)이고 리스팅 총량과 무관하다.
  - **혼합 세트 판정에는 그 리스팅의 옵션이 전부 필요하다.** 그래서 `target_listings` 로 대상 리스팅을 먼저 좁히고(spaceId + productId), `listing_products` 는 그 리스팅들의 **전체 옵션**을 집계한다. 상품으로 옵션까지 거르면 혼합 세트가 단일 상품으로 오판된다
  - 첫 구현은 CTE 에 범위 제한이 없어 **매 페이지마다 DB 전체의 `ProductListingItem` 을 테넌트 경계 없이 GROUP BY** 했다. 최종 `WHERE` 가 유출은 막지만 겨냥한 규모에서 새 병목이 된다 — 그룹 키가 아닌 컬럼 조건이라 Postgres 가 CTE 안으로 밀어 넣어 주지 않는다
  - 동일성 검증: dev DB 실측(2 space, mismatch 0) + **혼합 세트가 dev DB 에 0건이라** 합성 데이터를 트랜잭션으로 만들어 비교 후 롤백. 성능 개선폭은 dev DB 규모(331행)로는 입증 못 함 — prod 규모에서 재현 필요
- ~~전파 라우트 배선에 자동 테스트가 없다~~ → **해소(2026-08-25).** `src/lib/sh/__tests__/channel-product-name-propagate.e2e.test.ts` 6건. 라우트 핸들러를 직접 호출하고 `resolveDeckContext` 를 모킹하는 기존 e2e 관례를 따른다(dev DB 에 throwaway space, `afterAll` 정리, DB URL 없으면 skip). 실행: `npx jest --config jest.config.e2e.ts <파일>`
  - 덮은 것: 플래그 없으면 자식 불변 / 플래그 있으면 접미사 보존 전파 / mixed CP 는 400 이고 저장 **전** 거절 / **old base 가 컬럼이 아니라 역산값** / `managementName`·`internalCode`·`memo` 불변 / `KeywordChangeLog` 는 base 기준 1건
  - **핵심은 "역산 vs 컬럼" 케이스다.** 나머지는 누가 old base 를 컬럼으로 바꿔도 통과할 수 있다. 그래서 컬럼값을 자식 이름과 일부러 어긋나게 심어 두 구현이 서로 다른 결과를 내도록 구성했다 — 컬럼을 쓰면 접두어 매칭이 실패해 `buildSuffix` 폴백으로 빠지면서 **없던 옵션 접미사를 지어붙인다**(`새상품 블랙`), 역산이면 `새상품` 이 나온다

---

## Phase 5 — AI 초안 생성 (✅ 구현 완료 — 2026-08-25)

> **2026-08-25: 사용자가 외부 LLM SaaS 사용을 명시적으로 승인.** 아래 "결정 필요" 가 해소됐다.
> `src/lib/ai/providers/index.ts` 헤더의 "외부 LLM SaaS 금지" 문구도 사실에 맞게 고쳤다 —
> 공유 체인은 여전히 로컬/self-host 전용이고, 재무와 seller-hub 두 곳만 Gemini API 직결 예외다.

### 구현 결과

- `src/lib/sh/keyword-ai-draft.ts` — `@google/genai` 직결. **절대 throw 하지 않는다**(키 미설정·API 오류·파싱 실패 전부 `null`). 재무 `ai-suggest.ts` 와 같은 구조
- `POST /api/sh/products/[productId]/name-draft` — body `{ channelId }`. 상품 컨텍스트 + 채널 규칙(`loadKeywordRules` 재사용) → 초안 → **후보마다 검증 결과를 붙여** 반환. AI 실패는 502 가 아니라 **200 + `unavailable: true`** — 초안은 부가 기능이고 화면이 에러로 죽으면 안 된다
- UI 는 상품 축 카드의 `✨ AI 초안` 버튼 + 다이얼로그. **`!readOnly && !nameLocked` 일 때만 렌더**(연동 채널·섞인 CP 는 어차피 이름을 못 바꾼다)
- **후보를 버리지 않는다.** 위반을 배지로 표시하고 사용자가 판단한다
- **`적용` 은 입력란만 채운다.** 저장은 기존 버튼으로만 — 변경 사유 게이트(§25-26)를 우회하는 경로를 만들지 않았다
- `TextGenerationLog` 에 성공·실패 모두 기록(`provider: 'gemini-api'`, latency, preview 500자). **마이그레이션 없음**

### 구현하며 드러난 것

- **`thinkingConfig` 없이 부르면 조용히 실패한다.** gemini-2.5-flash 가 thinking 토큰 980개로 `maxOutputTokens` 를 다 먹어 JSON 이 잘리고 파싱이 실패한다 → `null`. 실제로 호출해 보기 전까지 안 드러났다. 재무와 동일하게 `thinkingBudget: 0` 으로 해결
- **사용량 기록을 fire-and-forget 하면 유실된다.** Vercel 서버리스는 응답 직후 인스턴스를 얼려서, `await` 하지 않은 로그 write 가 사라진다 — 하필 관측이 제일 중요한 FAILED 경로가 그 위험에 노출된다. 헬퍼가 프라미스를 **반환**하고 호출부가 **`await`** 해야 둘 다 성립한다(레포의 기존 4곳이 그렇게 한다)
- **검색어 §10 중복 판정 기준은 "지금 등록된 상품명"이다.** AI 후보를 기준 삼으면 후보 3개 중 무엇을 고를지 모르는 상태에서 검증 기준이 매번 달라지는 순환이 생긴다. 대신 다이얼로그가 그 전제를 문구로 알린다

### 쿼터

**넣지 않았다.** `TextGenerationLog` 로 실측한 뒤 근거를 갖고 정한다 — 실측 없이 상한을 정하면 근거 없는 숫자가 된다.

---

## Phase 5 원설계 (참고)

> **2026-08-20 결정: 이번 범위에서 제외.** Phase 1~4를 먼저 낸다.
> 아래 조사 결과는 재개 시점에 그대로 유효하다 — 특히 공유 체인이 prod에서
> 죽어 있다는 사실은 재개 전 반드시 다시 확인할 것(그 사이 고쳐졌을 수 있다).

⚠️ **공유 AI 체인은 prod에서 동작하지 않는다. 확인된 사실이다.**

`generateTextWithFallback`의 폴백 순서는 codex CLI → gemini CLI → Ollama인데,

- codex·gemini: `fs.existsSync(binPath)` — Vercel 서버리스에 바이너리가 없다
- Ollama: 기본 엔드포인트가 `http://127.0.0.1:11434`, prod에 `OLLAMA_ENDPOINT` 미설정

**셋 다 실패하고 throw한다.** 이 체인으로 만들면 배포 즉시 죽는다.

### 검증된 유일한 경로

재무 모듈이 이미 같은 문제를 겪고 우회했다. `src/lib/finance/ai-suggest.ts`는 `@google/genai` SDK로 Gemini API를 직접 호출하고, **`GEMINI_API_KEY`가 prod에 실재한다**(53일 전 등록, production+preview).

따라서 Phase 5는 **재무 패턴을 따른다**. 공유 CLI 체인은 건드리지 않는다.

> **결정 필요**: `src/lib/ai/providers/index.ts` 헤더는 *"외부 LLM SaaS 금지"*를 명시한다. 재무가 이미 예외를 뒀지만, 이 원칙을 seller-hub까지 확대할지는 정책 판단이다. 이 결정 없이는 Phase 5를 시작하지 않는다.

### 범위

- **초안 생성만 AI.** 검증·수정·점수는 결정론적으로 유지한다. AI가 만든 초안도 `validateProductName`을 통과해야 한다
- 입력: 상품 기본정보(브랜드·카테고리·소재·특징) + 채널 규칙 + 가이드 §22 템플릿
- 출력: 상품명 후보 3개 + 검색어 후보. **사용자가 고르기 전에는 아무것도 저장하지 않는다**
- 실패는 조용히 degrade — AI가 죽어도 결정론적 기능은 그대로 동작해야 한다

### 비용·쿼터

`WorkspaceAiCredit`는 **이미지 전용**이고 텍스트 쿼터는 없다. 상품명 생성은 호출당 토큰이 작지만 상품 수만큼 반복될 수 있다. `TextGenerationLog`에 기록해 실측한 뒤 쿼터 도입을 판단한다. 실측 없이 상한을 정하면 근거 없는 숫자가 된다.

---

## 하지 않는 것

- **P5 쿠팡 자동수집** — 별건. Akamai 차단으로 보류 상태 유지
- **좌측 목록 위반 배지** — 위 Phase 4 참조
- **검색옵션(§20)** — 관리할 데이터가 여전히 없다
- **마스터 → 리스팅 역방향 반영** — D1 재정의에서 명시적으로 제외

---

## 리스크

| 리스크                                 | 대응                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `validateListingNaming` 반환 형태 변경 | 호출부가 `keyword-warnings.ts` 하나뿐. 타입으로 잡힌다                      |
| 키워드 관리 화면 전면 교체             | 기존 키워드 축은 탭으로 보존. 데이터 손실 없음                              |
| 자동 축적이 마스터를 오염              | 삭제 전파 없음 + 상태를 `SEARCH_TERM`으로 고정. 사용자가 사전에서 정리 가능 |
| 채널 규칙 파생이 기존 채널 표시를 바꿈 | 쿠팡 100 → 120으로 완화되는 방향. 기존 데이터가 갑자기 위반이 되지 않는다   |
| AI 정책 확대                           | Phase 5 시작 전 별도 확인                                                   |
