# 세일즈 콘텐츠 AX 전환 계획

**목표:** 의식주의 에이전트(에밀리)가 브랜드별 블로그·SNS 오가닉 콘텐츠를 MCP로 만들고, 구성원이 승인한 것만 발행된다.

**결정(2026-10-18):** 새 Deck을 만들지 않고 기존 `sales-content`를 전환한다. 채널 연동·워커 발행·성과 수집을 재사용하고, 브랜드 구조와 진입점만 AX 원칙(kaleos-ax-project `CONTEXT.md`, spec `2026-10-09-ax-control-plane-design.md`)에 맞춘다.

## 점검 근거 (prod 읽기 전용, 2026-10-18)

- 활성 설치는 의식주의 Space 1곳(2026-07-22). 브랜드 프로필·상품·페르소나·온보딩·콘텐츠·배포·AI 설정 모두 0행 → 스키마 변경에 데이터 이전 부담 없음.
- `BrandProfile.spaceId @unique` = Space당 브랜드 1개. 의식주의는 한 Space에 브랜드 3개(seller-hub `Brand`: 미닝랩·에이엠엘·크림드).
- sales-content MCP 도구 0개, `SCOPES`에 sc 없음.
- `generateTextForSpace`는 `UsageEvent`를 기록하지 않는다.
- 브랜드 어휘가 이미 두 벌이다: seller-hub `Brand.name`(한글 3개) vs 메타 자격증명 `adAccounts` 키(`aml`·`kreamd`·`ameaning`·`meaninglab`). 이번 범위에서는 seller-hub `Brand`를 원본으로 삼고, 메타 키와의 매핑은 ⑤ 착수 때 다룬다.

## 원칙

- 브랜드 원본은 seller-hub `Brand` 테이블 하나. 새 Brand 목록을 만들지 않는다.
- 에이전트 쓰기는 `createPendingAction`만 호출한다(직접 변경 금지). 구성원이 화면에서 하는 작업은 기존 흐름 유지.
- PR당 마이그레이션 1개, TDD, Claude 작성 PR은 Codex 리뷰, 머지는 사람. 워크트리 → develop → main.
- 새 테이블을 만들면 마이그레이션에 `ENABLE ROW LEVEL SECURITY`를 넣는다(RLS 회귀 테스트).

## PR0 — AI 사용량을 UsageEvent에 기록 (스키마 변경 없음)

- [x] `src/lib/ai/resolve.ts` `generateTextForSpace`: 성공 시 `UsageEvent` 1행. `source:'workdeck'`, `provider`=실제 공급자 이름, `planClass`=WORKDECK→`payg` / BYOK→`byok` / LOCAL_CLI→`local`, `model`, 토큰. 세 번째 인자 `UsageContext { actor?, workId?, requesterUserId? }` — 라우트는 로그인 사용자, MCP 경유 시 ctx 값을 넘기고, 없으면 `system`.
  - `byok`는 AX spec의 planClass 어휘(sub·payg·local)를 확장한 값이다. 고객 키 비용을 워크덱 비용과 섞지 않으려는 것.
  - 실행자 전달: 범용 생성·콘텐츠 생성·온보딩(초안·상품 분석)·아이디어·상품 링크 추출. 발주 근거·인사이트는 system.
- 기록 실패는 응답을 막지 않는다(`recordTokens`와 같은 try/catch).
- 테스트: 모드별 planClass, 기록 실패 시 결과 반환.

## PR1 — 브랜드 단위 데이터 (마이그레이션 1개)

- `BrandProfile`: `spaceId @unique` 제거, `brandId String? @unique`(→ `Brand`, onDelete Cascade) 추가, `@@index([spaceId])`. `brandId = null` 행은 "Space 공통" 1개만 허용(부분 unique index를 SQL로 추가).
- `Product`: `brandId String?`(→ `Brand`, onDelete SetNull) + 인덱스.
- 영향 코드(main 기준 `brandProfile` 참조 ~20곳): `findUnique({ where: { spaceId } })` → `findFirst({ where: { spaceId, brandId } })`. 브랜드 미지정이면 공통 프로필.
  - `app/api/sc/brand-profile/route.ts`, `onboarding/{save,status,logo}`, `contents/[id]/generate`, `src/lib/sc/ideation.ts`, `src/lib/sc/schemas.ts`, settings 화면.
- 콘텐츠 생성 프롬프트: 상품의 `brandId` → 해당 브랜드 프로필, 없으면 공통 프로필.
- seller-ops 상품 가져오기(`map-inv-product.ts`): `InvProduct.brandId`를 그대로 복사.
- 설정 화면: 브랜드 탭에 브랜드 선택(seller-hub Brand 목록 + "공통"). seller-hub 미설치 Space는 공통만.
- 테스트: 브랜드별 프로필 분리, 공통 폴백, 가져오기 시 brandId 보존, 마이그레이션 후 기존 단일 프로필은 공통으로 남음.

## PR2 — 읽기 MCP 도구 (스키마 변경 없음)

- `src/lib/agent/identity/principal.ts` `SCOPES`에 `sc:read`, `sc:write` 추가(scope-contract 테스트 통과).
- `src/lib/agent/tools/sales-content-tools.ts`, 전부 `requireDeck(ctx.spaceId, 'sales-content')`:
  - `sc_list_brands` — 브랜드 + 프로필(톤·설명·customFields)
  - `sc_list_products` — `brand?` 필터, 페르소나 연결 포함
  - `sc_list_personas`
  - `sc_list_channels` — 채널 목록(자격증명 값 제외, 연결 여부만)
  - `sc_list_contents` — `status?`·`brand?`·기간 필터, 본문은 앞부분만
  - `sc_get_content` — 본문·버전·배포·성과
- 라우트와 같은 조회 함수를 공유한다(seller-hub 도구 패턴).
- **운영 작업(사람):** 의식주의 에밀리 `SpaceAgentIdentity.scopes`에 `sc:read`(PR3 후 `sc:write`) 추가. prod 데이터 변경이라 사용자가 승인·실행.
- 테스트: deck 비활성 거부, scope 없는 토큰 403, 다른 Space 데이터 미노출.

## PR3 — 콘텐츠 제안·승인 (승인 단위 확정 후 상세화)

- 후보: `sc_propose_post`(브랜드·상품·채널·초안·예약 시각) 1건 → 승인 1회 → `Content`(APPROVED) + `ContentDeployment`(SCHEDULED) 생성 → 기존 워커 발행.
- `src/lib/agent/actions/sales-content.ts` + `registry.ts` 등록. 실행 시 채널이 같은 Space인지·활성인지 재검증.
- 구성원 화면 흐름의 `IN_REVIEW`→`APPROVED`는 유지한다.
- 결정(2026-10-18): 게시물 1건에 승인 1회.

## PR4 — 화면 정리

승인·결과 확인·채널 설정 중심으로 정리. 온보딩 위저드는 선택 기능으로 낮춤(삭제 아님).

## 범위 밖

- 메타 광고 소재(⑤), 브랜드 어휘 통합(seller-hub ↔ 메타 키), 지식 소스(Notion) 연동(⑨), 사용량 체계 통합(⑦).
