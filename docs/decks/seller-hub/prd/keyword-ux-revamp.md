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
nameHardMax  = 채널 상한 (쿠팡은 가이드 §7의 120)
nameSoftMax  = min(80, hardMax)
nameTargetMax = min(70, hardMax)
nameTargetMin = min(40, floor(hardMax * 0.6))
```

무신사(30) → 목표 18~30, 권장상한 30, 절대 30. 모순이 사라진다.

**쿠팡은 가이드 값을 쓴다**(40/70/80/120). `channel-name-limits.ts`의 100은 출처가 없는 값이라 버린다.

`NameCounter`는 세 곳(`listing-form`·`listing-create-form`·`group-base-info-card`)에 중복 정의돼 있다. 공용 컴포넌트로 합치고 `KeywordRuleSet`을 받게 한다.

### 검증

- 쿠팡·무신사·미등록 채널 각각의 파생값 테스트
- 한 화면에 기준이 하나만 보이는지 육안 확인

---

## Phase 3 — 마스터 자동 축적

Phase 4가 의미를 가지려면 데이터가 있어야 한다.

- `POST /api/sh/products/listings`, `PATCH .../[listingId]`, `PATCH .../channel-products/[id]`에서 저장 성공 후 키워드를 마스터로 흡수
- 흡수 로직은 `src/lib/sh/keyword-absorb.ts` — 라우트 3곳이 공유
- `KeywordMasterLink`는 리스팅 단위(`listingId`)로 건다. 상품 단위(`productId`) 링크는 구성 옵션이 한 상품일 때만 추가로 건다(`resolveBaseProduct` 재사용)
- **실패해도 저장을 되돌리지 않는다.** 흡수는 부가 기능이고, 이것 때문에 저장이 실패하면 안 된다. 실패는 로깅만.

기존 `RegisterKeywordsButton`(수동 등록)은 남긴다 — 자동 흡수는 저장 시점에만 일어나므로, 저장 없이 사전에만 넣고 싶을 때 필요하다.

### 검증

- 리스팅 저장 → 마스터 행·링크 생성 확인
- 같은 키워드 재저장 → 중복 생성 없음(409 경로)
- 리스팅에서 키워드 삭제 → **마스터에 남아 있는지** 확인(삭제 전파 없음)

---

## Phase 4 — 상품 축 2-pane 화면

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

### 의도적 제외

좌측 목록에 **위반 배지를 넣지 않는다.** 모든 상품의 모든 리스팅에 대해 위반을 미리 계산해야 하는데, 첫 화면 로딩에 그 비용을 치를 만한 근거가 아직 없다. 선택한 상품만 우측에서 계산한다. 필요해지면 그때 추가한다.

### 검증

- 상품 선택 → 채널별 상품명·키워드 표시
- 인라인 저장 → 변경 이력 기록 확인
- 연동 채널 카드가 읽기전용인지 확인

---

## Phase 5 — AI 초안 생성

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
