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

## PR1 — 브랜드 단위 데이터 (마이그레이션 `20261018120000_sc_brand_scoped_profile`)

- [x] `BrandProfile`: `spaceId @unique` 제거, `brandId`(→ `Brand`, Cascade) + `@@unique([spaceId, brandId])`. `brandId = null` = Space 공통 프로필. 기존 행은 공통으로 남는다.
  - 공통 프로필 1개 제약: Postgres 는 NULL 을 서로 다른 값으로 봐서 unique 로 안 걸린다. 부분 인덱스는 Prisma 가 drift 로 지울 위험이 있어 쓰지 않고, `src/lib/sc/brand-profile.ts` `saveBrandProfile` 이 advisory lock 트랜잭션으로 보장한다(온보딩 자료 등록과 같은 방식).
- [x] `Product.brandId`(→ `Brand`, SetNull). seller-ops 가져오기는 `InvProduct.brand.id` 를 그대로 잇는다. 링크 추출·온보딩 상품은 null.
- [x] 생성 프롬프트(콘텐츠 섹션·아이데이션): 상품 브랜드 프로필 → 없으면 공통 (`findBrandProfileForProducts`). 여러 브랜드가 섞이면 브랜드가 지정된 첫 상품을 따른다.
- [x] API: `GET /api/sc/brands`(seller-hub Brand 읽기), `GET/PUT /api/sc/brand-profile?brandId=`, 상품 POST/PATCH `brandId`. 다른 Space 의 brandId 는 404.
- [x] 화면: 브랜드 프로필 탭·상품 폼에 브랜드 선택(브랜드가 없는 Space 는 숨김). 온보딩·로고는 공통 프로필.
- [x] 검증: jest(헬퍼 5·라우트 2·매핑 2 추가, sc·ai 235 통과), tsc 0, dev 서버 브라우저 QA(공통/크림드 분리 저장·재조회, 공통 2회 저장 시 1행, 상품 브랜드 저장). QA 데이터는 삭제.

## PR2 — 읽기 MCP 도구 (스키마 변경 없음)

- [x] `src/lib/agent/identity/principal.ts` `SCOPES` 에 `sc:read`, `sc:write` 추가. 구성원 세션은 전체 scope 라 바로 쓸 수 있고, 에이전트는 부여가 필요하다.
- [x] `src/lib/agent/tools/sales-content-tools.ts`, 전부 `requireDeck(ctx.spaceId, 'sales-content')`:
  - `sc_list_brands` — 브랜드 + 브랜드별 프로필, `commonProfile`
  - `sc_list_products` — `brand`(이름 또는 id) 필터, 페르소나 연결 포함
  - `sc_list_personas`, `sc_list_channels`(자격증명·config 제외, `hasCredential` 만)
  - `sc_list_contents` — `status`·`limit`, 본문 앞 300자
  - `sc_get_content` — 전체 본문·배포·배포별 성과 합계
  - 콘텐츠 브랜드 필터는 없다(Content 에 브랜드 컬럼 없음). PR3 제안 도구에서 필요하면 다룬다.
- [x] 검증: 단위 테스트(deck 게이트·Space 범위·브랜드 해석·자격증명 비노출), scope 계약 테스트, dev DB 실조회(의식주의 브랜드 3개).
- **운영 작업(사람):** 에밀리 `scopes` 에 `sc:read` 추가. ADMIN 이 `PATCH /api/spaces/{spaceId}/agents/{agentId}` 로 바꿀 수 있다(전체 scope 배열을 보낸다). PR3 후 `sc:write`.

## PR3 — 게시물 제안·승인 (스키마 변경 없음)

- [x] 결정(2026-10-18): 게시물 1건에 승인 1회.
- [x] MCP `sc_propose_post`(sc:write): 제목·본문(텍스트, `#`~`###` 줄은 소제목, 50자 이상)·채널·연결 URL·예약 시각 → `createPendingAction`. 같은 제안 재시도는 멱등 키로 1건.
- [x] 액션 `sales-content.post.publish`(`src/lib/agent/actions/sales-content.ts`, ADMIN 승인): 생성 시 카드·활성 채널 확인, 실행 시 채널 재확인 → `Content`(SCHEDULED, 작성자=승인자, 본문→TipTap doc) + `ContentDeployment` + `SCHEDULED→PUBLISHING` + PUBLISH 작업 예약(배포 실행 API 와 같은 전이). 실패하면 만든 콘텐츠를 지운다(배포 cascade). 예약 시각이 지났으면 승인 즉시 발행.
- [x] 배포 생성 로직을 `src/lib/sc/deployments.ts` `createDeployment` 로 빼서 배포 API 와 공유. 트랜잭션 안에서는 slug 충돌 재시도가 안 되므로 기본 클라이언트 전용.
- [x] 본문 변환 `src/lib/sc/text-to-doc.ts`: 워커가 paragraph/heading 만 읽으므로 두 노드만 만든다.
- [x] 구성원 화면 흐름(`IN_REVIEW`→`APPROVED`)은 그대로.
- [x] 검증: dev DB e2e(`sales-content-actions.e2e.test.ts`) — 승인 1회로 콘텐츠·배포·작업 생성, 중복 제안 1건, 실행 전 채널 비활성 시 FAILED+잔여 0, 다른 Space 채널 제안 거부.
- [x] Codex 리뷰 반영: 배포를 처음부터 PUBLISHING 으로 만들어 배포 실행 API 와의 중복 발행 경합 제거, 콘텐츠·배포·작업을 한 트랜잭션(slug 충돌 시 트랜잭션 재시도), targetUrl http(s) 만(배포 API·`/c/[slug]` 리다이렉트 포함), 멱등 키는 거절·만료 액션이면 풀고 새로 만든다(`createPendingAction` 공통). 실패(FAILED)는 외부 API 가 이미 실행됐을 수 있어 `retryableAfterFailure: true` 로 선언한 액션(이 액션 — 단일 트랜잭션)만 풀어 준다. slug 재시도는 `shortSlug` 위반만(실제 드라이버 어댑터 오류 meta 로 확인).
- 남은 것: 콘텐츠 브랜드 필터(Content 에 브랜드 없음), 발행 결과를 요청 스레드로 알리는 경로(`action_wait` 계획과 함께).

## PR4 — 승인·결과 확인 화면

- [x] 세일즈 콘텐츠 홈에 "에이전트 게시물 제안 N건" 카드(승인 대기 0건이면 숨김) → `/approvals?spaceId=`.
- [x] 승인 상세: 200자 넘거나 여러 줄인 값은 줄바꿈을 살려 아래 블록으로 전체 표시(본문을 끝까지 읽고 승인). 모든 덱 제안에 적용.
- [x] 승인 목록·상세 덱 라벨에 "세일즈 콘텐츠", 제안 요약에 채널 이름.
- [x] 온보딩 위저드는 이미 강제가 아니다(진행 카드 닫기 가능) → 그대로.
- [x] 검증: dev 서버 브라우저 QA(홈 카드 → 승인 화면 이동, 상세에서 본문 전체 표시). QA 데이터 삭제.

## 범위 밖

- 메타 광고 소재(⑤), 브랜드 어휘 통합(seller-hub ↔ 메타 키), 지식 소스(Notion) 연동(⑨), 사용량 체계 통합(⑦).
