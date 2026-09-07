# 판매채널 상품 상세에 AI 초안 추가 + 버튼 분리 + 연동 채널 잠금

## Context

키워드 관리 화면에만 있는 **AI 초안**을 판매채널 상품 상세(`/d/seller-ops/products/listings/groups/[channelProductId]`)에서도 쓰고 싶다는 요청.

조사에서 세 가지가 드러났다.

1. **키워드 추천 칩은 이미 그 화면에 있다**(`group-detail-view.tsx:242-270`, 커밋 `feacb98b`). 추가 작업 없음. 실제로 없는 건 AI 초안뿐이다.
2. **`externalSource` 스텁이 두 곳에 있다.** `group-detail-view.tsx:235`·`group-base-info-card.tsx:59` 가 `withChannelDefaults(..., { externalSource: null })` 로 넘긴다 — 그룹 상세 API 가 그 값을 안 내려주기 때문. 그 결과 **연동 채널 잠금이 없을 뿐 아니라 채널별 글자수 규칙도 비연동 기준으로 잘못 적용된다.** 잠금만 고치고 규칙을 두면 반쪽이다.
3. **AI 는 한 번 호출로 상품명·키워드를 함께 생성한다**(`keyword-ai-draft.ts:81` `generateContent` 1회, `{names, keywords}` 반환). 버튼을 나눠도 호출을 공유하면 비용이 안 는다.

사용자 확정 사항: 버튼 분리는 **두 화면 모두**, 연동 채널 잠금은 **이번에 같이**, 적용 후 저장은 **판매채널 상세의 자동저장 관례**를 탄다.

## 설계

### 호출은 화면당 1회

`NameDraftDialog` 안의 fetch 를 `useNameDraft(productId, channelId)` 훅으로 꺼내 **부모가 소유**하고, 두 버튼이 같은 인스턴스를 공유한다. `load()` 는 이미 로드됐거나 로딩 중이면 no-op.

캐시가 안전한 근거: AI 입력은 `InvProduct.name` / 마스터 링크 / 리스팅 키워드에서 오고(`name-draft/route.ts:95-104`), **사용자가 화면에서 타이핑 중인 값과 무관**하다. 무엇을 입력해도 후보 자체는 안 바뀐다.

### 다이얼로그는 `mode` 로 나눈다

`NameDraftDialog` 에 `mode: 'name' | 'keyword'` 를 주고 해당 섹션만 렌더한다. 하단 상태 바도 항목별로 쪼갠다. 컴포넌트를 둘로 복제하면 위반 배지·툴팁·`normalizeKeyword` 필터가 두 벌이 된다.

### 자동저장 — 관례를 따르되 키워드만 800ms

- `onApplyName` → **`handleBaseChange('searchName', v)`**. `setBaseSearchName` 직접 호출 금지(타이머가 안 걸린다)
- `onAddKeyword` → 새 핸들러로 `scheduleAutoSave(800)`. 기존 `handleKeywordsChange` 의 **0ms 는 `KeywordEditor` 의 개별 Enter 커밋에 맞춘 값**이라, 다이얼로그에서 칩을 연속으로 누르면 클릭마다 저장 시도가 난다

**게이트는 이미 우회를 막고 있다.** `snapGated = gateNeeded && !changeMeta` 라 사유 없는 자동저장에서는 `baseSearchName`·`keywords` 가 PATCH 바디에서 빠진다(`:961`, `:967`). 즉 "AI 적용 → 사유 없이 저장" 경로는 열리지 않는다. 적용은 로컬 state 를 바꾸고 저장 버튼이 `변경 사유 입력` 으로 바뀔 뿐 — **직접 타이핑했을 때와 동일**하다.

### 연동 채널 잠금 범위

키워드 관리 카드와 정확히 대칭으로 맞춘다.

- **잠근다**: `baseSearchName`·`baseDisplayName` 입력, 두 `NameValidationPanel`, `KeywordEditor`(+`suggestions` 숨김), AI 버튼 2개
- **안 잠근다**: `baseManagementName`·`baseInternalCode`·`memo`(관리용, 키워드 카드에 대응물 없음), 옵션 행(가격·재고·판매상태), 옵션 CRUD, 키워드 복사 버튼, 저장 버튼 자체 — 가격·재고 변경은 계속 저장돼야 한다
- 카드 헤더에 `Lock` + `연동 채널 (읽기전용)` 배지(`product-keyword-card.tsx:179,185` 패턴 재사용)

**PATCH 라우트는 `externalSource` 를 검사하지 않는다.** 이 잠금은 순수 클라이언트 UX 규칙이다 — 코드 주석에 남겨 "서버가 막아주니 괜찮다"는 오해를 방지한다.

### mixed 구성

`productId === null`(여러 상품이 섞인 CP)이면 두 버튼 모두 **비활성 + 툴팁**(`혼합 구성에서는 사용할 수 없습니다`). 숨기면 "기능이 없다"로 오인된다. AI 초안은 단일 `InvProduct` 를 입력 근거로 삼으므로 mixed 에서는 성립하지 않는다.

## 작업 단위

### Task 1 — fetch 를 훅으로 추출 + `mode` 분리

- 신규 `src/components/sh/products/keywords/use-name-draft.ts`
- 수정 `src/components/sh/products/keywords/name-draft-dialog.tsx`

훅 상태: `status: 'idle'|'loading'|'success'|'unavailable'`, `names`, `keywords`, `load()`. `cancelled` 가드와 **"실패는 조용히 unavailable, 토스트 없음"** 동작을 그대로 보존한다. 다이얼로그는 프레젠테이션 전용이 되고 `mode` 로 섹션을 가른다.

**확인**: 두 모드 각각 단독 마운트해도 컴파일 통과.

### Task 2 — 키워드 관리 카드 배선

- 수정 `src/components/sh/products/keywords/product-keyword-card.tsx`

`draftOpen` 단일 state → `nameDraftOpen`/`keywordDraftOpen`. `useNameDraft` 한 번 호출해 두 다이얼로그가 공유. 상품명 라벨 옆 버튼은 유지하고 **키워드 쪽에 버튼을 신설**한다. 두 버튼 모두 `!readOnly && !nameLocked` 조건 유지.

**`handleSave`/`dirty`/`gateRequired`/body 구성은 diff 가 없어야 한다.**

**확인**: 이름 → 키워드 순서로 둘 다 열어도 Network 에 `name-draft` 호출이 **1회만**.

### Task 3 — 그룹 상세 GET 에 `externalSource` 추가

- 수정 `app/api/sh/products/listings/channel-products/[id]/route.ts`

`channel.select` 에 `externalSource: true` 추가하고 응답 `channel` 에 실어 보낸다. **기존 응답 필드는 건드리지 않는다**(클라이언트가 타입을 선언한다).

**확인**: 연동 채널 CP 를 조회해 `channel.externalSource` 가 non-null.

### Task 4 — 규칙 스텁 제거 + 잠금 배선

- 수정 `src/components/sh/products/listings/group-detail-view.tsx`
- 수정 `src/components/sh/products/listings/group-base-info-card.tsx`

`externalSource: null` 스텁 두 곳을 실제 값으로 교체한다. **`rules` 계산을 `group-detail-view` 로 끌어올려 한 곳에서만 만들고** 카드들에 props 로 내리는 편이 낫다 — 지금처럼 두 곳에서 각자 계산하면 한쪽만 고치는 재발이 난다.

`GroupBaseInfoCard` 에 `namesReadOnly` prop 을 새로 받는다. **기존 `disabled` 와 분리해야 한다** — `disabled` 는 옵션 CRUD 중(`mutating`)을 뜻하고 의미가 다르다.

**확인**: 비연동 채널 화면이 기존과 동일. 연동 채널에서 이름·키워드가 읽기전용이고 배지가 뜬다.

### Task 5 — AI 버튼 2개 배치 + 다이얼로그 배선

- 수정 `group-base-info-card.tsx`(상품명 버튼), `group-detail-view.tsx`(키워드 카드 `CardAction` 에 버튼, 다이얼로그 2개, 새 핸들러)

키워드 버튼은 기존 "키워드 복사" 옆에 둔다. `handleKeywordDraftAdd` 는 중복 체크 후 `scheduleAutoSave(800)`.

**확인**: mixed CP 에서 두 버튼 비활성 + 툴팁. 칩 3개 연속 클릭 시 저장 시도가 마지막 클릭 800ms 뒤 한 번.

### Task 6 — 검증

## 검증

1. `npx tsc --noEmit` / `npm run lint` / `npx jest`(**1050건** 기준) / `npm run build`
2. **회귀** — 비연동 채널 그룹 상세에서 이름·키워드를 직접 고쳐 저장하는 기존 흐름이 그대로인지. 키워드 관리 카드의 저장·게이트도 동일한지
3. **신규** — 이름 AI 적용 → 게이트 다이얼로그 → 사유 입력 → 저장. 키워드 AI 칩 연속 클릭 → 저장 시도 1회
4. **연동 채널** — 이름·키워드 잠김, AI 버튼 미노출, 배지 표시. **가격·재고는 여전히 편집·저장 가능**
5. **mixed** — 두 버튼 비활성 + 툴팁
6. **호출 수** — 한 화면에서 두 다이얼로그를 다 열어도 `name-draft` 1회
7. **시각 확인은 로컬 dev 에서 실제 렌더를 본다.** 최근 UI 수정 3건을 코드로만 추론하다 한 번 헛짚었다
8. 릴리스: 브랜치 → develop → release PR → main
