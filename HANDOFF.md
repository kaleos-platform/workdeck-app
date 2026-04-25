# Sales Content Deck — Phase 1 완주 (2026-04-24)

> Phase 1 (13 Unit) 전부 구현 완료. 이 문서는 구현 이후 연속 진행 사항을 요약하고,
> 실제 스모크 테스트 · 외부 통합 작업에 필요한 맥락을 모아둔다.

## 지금 어디까지 왔나

**완료:**

- [x] 계획 승인: [docs/plans/2026-04-24-001-feat-b2b-marketing-deck-plan.md](docs/plans/2026-04-24-001-feat-b2b-marketing-deck-plan.md) — Phase 1 PoC 13 units, 3축 어댑터(TextProvider/ImageProvider/Publisher/MetricCollector)
- [x] **Unit 1** (commit `871e4c4`): Deck 등록·라우팅·사이드바 스켈레톤
- [x] **Unit 2** (commit `c755cb2`): 정보 세팅 도메인 — B2BProduct·Persona·BrandProfile CRUD
  - 3개 Prisma 모델 + migration SQL (`prisma/migrations/20260424063907_feat_sales_content_settings/`)
  - API 5개, 폼·리스트 컴포넌트 5개, 페이지 7개, 사이드바 활성화
  - ⚠️ **누락 발견 → Unit 3 커밋에서 복구**: `c755cb2` 는 `schema.prisma` 의 3개 모델 정의를 커밋에서 빠뜨렸음. 빌드가 실제로는 실패하는 broken 상태였음. Unit 3 세션에서 `schema.prisma` 에 B2BProduct/Persona/BrandProfile + Space 역관계를 함께 추가하여 복구.
- [x] **Unit 2 migration 배포**: `20260424063907_feat_sales_content_settings` → Supabase dev DB 적용 완료 (이번 세션).
- [x] **Unit 3** — AIProvider 어댑터 + 이미지 크레딧 시스템
  - Prisma: `WorkspaceAiCredit`, `ImageGenerationLog`, `TextGenerationLog`, `AiGenerationStatus` enum
  - Migration `20260424070000_feat_sales_content_ai` 작성 + **dev DB 배포 완료**
  - `src/lib/ai/providers/{index,text-claude-code-acp,text-ollama,image-gemini}.ts` + factory (`generateTextWithFallback`)
  - `src/lib/ai/credit.ts` — atomic reserve (raw UPDATE WHERE imageUsed < imageQuota) + commit/refund + getMonthUsage
  - API: `/api/sc/ai/generate-text`, `/api/sc/ai/generate-image`, `/api/sc/ai/credit`
  - `.env.local.example` 신규 (기존 저장소에 없었음) + Unit 3 env 항목
  - 테스트 파일 2개 (credit, ACP provider — 저장소 jest 설정 미완으로 실행은 불가, 아래 참조)
- [x] **Unit 4** — 아이데이션 (글감 후보 생성)
  - Prisma: `ContentIdea` 모델 + `IdeaGeneratedBy` enum + Space/B2BProduct/Persona 역관계
  - Migration `20260424080000_feat_sales_content_ideation` 작성 + **dev DB 배포 완료**
  - `src/lib/sc/prompts.ts` — ideation prompt builder (상품·페르소나·브랜드·규칙 렌더) + 정규화 SHA-256 trace hash
  - `src/lib/sc/ideation.ts` — orchestrator: 맥락 로드 → `generateTextWithFallback` 호출 (1회 재시도) → JSON parse + zod 검증 → `ContentIdea` 저장. `runIdeation` / `saveUserIdeation` export.
  - API: `GET/POST /api/sc/ideations`, `GET/DELETE /api/sc/ideations/[id]` (`mode: 'ai' | 'user'`)
  - UI: `IdeationForm` (상품·페르소나 Select + 지시 Textarea + 개수 Select), `IdeaCard`, `IdeationList` + `/d/sales-content/ideation{,/[id]}` 페이지 2종
  - 사이드바 "아이데이션" 메뉴 활성화
  - `src/lib/sc/__tests__/prompts.test.ts` — builder / traceHash 단위 테스트 (저장소 jest 미완으로 실행은 불가)
  - ⚠️ **End-to-end 실제 실행은 아직 안 됨**: Bridge 쪽 `/sales-content/generate` 라우트 미구현 + 로컬 Ollama 미기동 → 첫 실제 ideation 호출이 진짜 스모크 테스트. 현재는 build/lint/schema 레벨에서만 검증.
  - `ImprovementRule` 주입은 `loadActiveRules()` 스텁으로 자리만 확보 (Unit 13 에서 본체 교체).

- [x] **Unit 5** (`9a13694`) — 템플릿 시스템
  - Template (spaceId nullable — null+isSystem=시스템) + SalesContentChannel + 5개 enum
  - 시스템 템플릿 3종(블로그 장문·소셜 텍스트·카드뉴스) seed 완료
  - `src/lib/sc/template-engine.ts` — zod 분기 검증 + skeleton 렌더
  - API 4종 + 사이드바 "템플릿", "채널" 활성화
- [x] **Unit 6** (`6ff8d73`) — 콘텐츠 제작 + TipTap
  - Content + ContentAsset + ContentStatus(6단계) + ContentAssetKind
  - TipTap (`@tiptap/react` 외 5개) 설치 + 경량 에디터 + 툴바
  - 상태 머신 `src/lib/sc/content-state.ts` — 전이 허용 매트릭스 + 최소 본문 길이 검증(50자)
  - API 4종 (GET/POST list, GET/PATCH/DELETE [id], POST transition, POST generate)
  - 사이드바 "콘텐츠" 활성화
- [x] **Unit 7** (`f987fad`) — 이미지 업로드 + AI 생성
  - `src/lib/supabase/storage.ts` — 버킷 `sales-content-assets`, path `{spaceId}/content/{contentId}/{uuid}.{ext}`
  - POST `/api/sc/contents/[id]/assets` 이원화: multipart 업로드 / `mode:'ai'` (Gemini → Storage put → ContentAsset)
  - `ImagePicker` UI, ContentEditor 에 integration
  - ⚠️ Supabase 대시보드에서 `sales-content-assets` 버킷 수동 생성 필요 (public, 20MB)
- [x] **Unit 8** (`b6f5aa6`) — UTM 빌더 + `/c/[slug]` 리다이렉터
  - ContentDeployment + ContentClickEvent + DeploymentStatus enum
  - `src/lib/sc/utm.ts` — normalizeKebab, buildTargetUrl, deriveUtmDefaults, generateShortSlug, hashIp
  - `/c/[slug]` 302 + fire-and-forget ContentClickEvent INSERT
  - DeployButton → 배포 예약 폼, 배포 상세 페이지
  - 사이드바 "배포 내역" 활성화
- [x] **Unit 9** (`ad3cb6d`) — 자격증명 + 작업 큐 + 워커 poller
  - ChannelCredential(AES-256-CBC, del/encryption 재사용) + SalesContentJob + 3개 enum
  - `claimJobs` — Postgres `FOR UPDATE SKIP LOCKED` 로 다중 워커 atomic 클레임
  - attempts 한도 3 초과 시 FAILED, 이내면 지수 백오프(1m/5m/15m)
  - `/api/sc/channels/[id]/credentials`, `/api/sc/jobs/worker`, `/api/sc/jobs/[id]/complete`
  - `worker/src/sc/job-poller.ts` polling 루프 스켈레톤
- [x] **Unit 10** (`67798a1`) — 배포 실행 Publisher
  - Exporter 3종 (blog-markdown, social-text, cardnews)
  - Publisher factory + Manual/Threads-api/Naver-blog-browser 스켈레톤 (실제 플랫폼 통합은 Phase 2)
  - POST `/api/sc/deployments/[id]/execute` → PUBLISH job enqueue + SCHEDULED→PUBLISHING
  - ExecuteDeploymentButton, 배포 상세 페이지
- [x] **Unit 11** (`9a5fd22`) — 성과 대시보드
  - DeploymentMetric + MetricSource enum (MANUAL/API/BROWSER/INTERNAL)
  - `getDeploymentMetricsTotal`, `getSpaceAnalyticsSummary` (groupBy 로 N+1 방지)
  - POST/GET `/api/sc/metrics/[deploymentId]`, GET `/api/sc/analytics/summary`
  - `/d/sales-content/analytics{,/[deploymentId]}` + MetricForm (6개 지표 수동 입력)
  - 사이드바 "성과" 활성화
- [x] **Unit 12** (`f80d193`) — Collectors 스켈레톤 + 스케줄러
  - Collector factory + Threads/네이버 블로그 스켈레톤
  - `src/lib/sc/collector-scheduler.ts` → PUBLISHED 배포에 대해 COLLECT_METRIC job 일괄 enqueue
  - POST `/api/sc/analytics/schedule-collection` (수동 트리거)
- [x] **Unit 13** (`ece3193`) — 개선 규칙 + 셀프-임프루빙 루프 연결
  - ImprovementRule + 3개 enum (RuleSource · RuleStatus · RuleScope)
  - `src/lib/sc/improvement.ts` `loadActiveImprovementRules` — scope 별 필터 + weight/updatedAt 정렬
  - **Unit 4 `loadActiveRules` 스텁을 dynamic import 로 실제 구현에 배선 완료**
  - `/api/sc/improvement-rules`, RuleList/RuleForm + `/d/sales-content/rules`
  - 사이드바 "개선 규칙" 활성화

**다음:**

- [~] Phase 2 실제 외부 통합
  - [x] **Unit 14** (commit `10c2c39`) — AI Insight Generator (셀프-임프루빙 루프 완성)
    - `src/lib/sc/insights.ts`: `aggregateDeploymentPerformance` (채널×템플릿×상품 버킷), `buildInsightPrompt` (JSON schema + 활성 규칙 중복 방지), `parseInsightResponse` (zod), `runInsightGeneration` 오케스트레이터
    - `POST /api/sc/insights/generate` — 세션/워커 양쪽 인증
    - `src/components/sc/rules/ai-insight-button.tsx` — 규칙 페이지 수동 트리거
    - `worker/src/sc/insight-generator.ts` — INSIGHT_SWEEP job 핸들러 (웹 API 호출 위임)
    - 테스트: `src/lib/sc/__tests__/insights.test.ts` 8 케이스 green
  - [x] **Unit 15** (commit `3cd4a9b`) — INSIGHT_SWEEP 스케줄러
    - `src/lib/sc/insight-scheduler.ts`: 대상 Space 선정(최근 N일 PUBLISHED 배포 있는 곳) + 12시간 내 PENDING/CLAIMED 중복 방지 + INSIGHT_SWEEP job enqueue
    - `POST /api/sc/insights/schedule` — 세션(현재 Space) / 워커(x-workspace-id 또는 allSpaces=true)
    - 맥미니 cron 에서 주 1회 `curl -H "x-worker-api-key: ..." -d '{"allSpaces":true}'` 로 전체 스윕 실행
  - [x] **Unit 16** (commit `e07d94d`) — 콘텐츠 버전 히스토리·롤백
    - Prisma `ContentVersion` + migration `20260428000000`
    - `src/lib/sc/content-versions.ts` — `snapshotContent` (P2002 동시성 재시도), `rollbackContent` (트랜잭션 + 자동 스냅샷), `nextVersionNumber` 순수 함수
    - API 3종: GET 목록 / GET 단건 / POST rollback — 모두 Space ownership 검증
    - PATCH `/api/sc/contents/[id]` 훅으로 자동 스냅샷
    - `src/components/sc/contents/version-history-panel.tsx` — Dialog 미리보기 + 롤백 확인
    - 테스트 5 케이스 (버전 계산 순수 함수)
    - 팀: 번스타인(backend) + 시라노(frontend)
  - [x] **Unit 17** (commit `8473bb0`) — SC 워커 엔트리포인트 + Publisher/Collector 에러 코드
    - `worker/src/sc/runner.ts` — kind 별 라우팅(PUBLISH/COLLECT_METRIC/INSIGHT_SWEEP) + `runScLoop` 무한 루프 + SIGTERM/SIGINT graceful shutdown
    - `worker/src/sc/index.ts` CLI + `npm run sc` 스크립트
    - `PublishResult.errorCode` / `CollectResult.errorCode` 추가 (AUTH_FAILED · RATE_LIMITED · VALIDATION · PLATFORM_ERROR · NOT_IMPLEMENTED · NETWORK)
    - 10개 유닛 테스트 (PUBLISH 4 + COLLECT 4 + INSIGHT 2)
  - [ ] Bridge ACP 라우트 (`POST /sales-content/generate` + `GET /health`) — `claude-code-bridge` 프로젝트
  - [ ] Threads API 실구현 (OAuth 토큰 + Graph API)
  - [x] **Unit 18** (commit `fb42b65`) — 네이버 블로그 Playwright 실구현
    - `scripts/sc/acquire-naver-session.ts` — `--auto` (env ID/PW) / `--manual` 두 모드. NID_AUT·NID_SES 쿠키 polling 으로 감지 후 storageState JSON 저장
    - `worker/src/sc/publishers/naver-blog-browser.ts` — SmartEditor ONE 대응: iframe(PostWriteForm) → 제목 클릭/타이핑 → 본문 클릭/타이핑 → 발행 버튼 → 최종 URL 캡처. 세션 만료 시 AUTH_FAILED 반환.
    - `worker/src/sc/publishers/_naver-doc-text.ts` — TipTap Doc → 문단 구분 plain text + CTA 삽입 (6 테스트)
    - `worker/src/sc/collectors/naver-blog-browser.ts` — 공개 포스트 DOM 파싱 (views/likes/comments, 셀렉터 폴백 체인)
    - `src/components/sc/channels/naver-credential-form.tsx` + 채널 상세 페이지 통합 — storageState.json 업로드 + blogId 입력 UI (BLOG_NAVER 플랫폼에서만 노출)
- [x] Repo-wide jest 설정 (신규 + Unit 3/4/5/6/8 테스트 활성화) — commit `ef486c8`, `jest.config.ts` next/jest preset 적용

### Phase 3 — 운영 준비 (2026-04-25)

- [x] **Naver Publisher 실 발행 검증** (commit `e7f7a92`) — meaning-lab/224264354857 발행 성공.
      3건의 루트 원인 확정·해소: ① `addInitScript` 누락(navigator.webdriver), ② Playwright
      `force:true` click 이 iframe se-help-layer 에 가로채임 → DOM click via evaluate 로 통일,
      ③ `dismissHelpOverlay` ESC fallback 이 publish 모달까지 닫는 버그 → 호출 제거. 재시도
      워커라운드 제거(-24 lines).
- [x] **Worker API ↔ Runner contract 정렬** (commit `365a346`) — Phase 3 First Smoke 에서
      발견한 critical bug. 워커 API 가 `payload` 가 아닌 top-level 로 deployment/credential 만
      내려서 runner 의 `buildPublishContext` 가 PublishContext 를 만들지 못하던 문제. assets +
      deploymentUrl 평탄화하여 PUBLISH·COLLECT 양쪽 정렬. 단위 테스트 갱신 + assets 전달 검증.
- [x] **non-retryable errorCode 즉시 FAILED** (commit `092db9c`) — AUTH_FAILED·RATE_LIMITED·
      VALIDATION·NOT_IMPLEMENTED 가 무한 retry 되던 문제. `failJob` 에 `nonRetryable` 옵션 추가,
      `isRetryableErrorCode` allowlist 헬퍼(NETWORK / PLATFORM_ERROR 만 retry), worker
      `completeJob` → API → `failJob` 으로 errorCode 전달. unknown 코드는 보수적으로 non-retryable.
- [x] **ops 도구** (commit `2fc4ead`) — `scripts/sc/ops/smoke-e2e.ts` (시드 → enqueue →
      poll), `scripts/sc/ops/db-stats.ts` (Space/Channel/Credential/Content/Deployment/Job
      row 카운트). 신규 환경 bring-up · contract 회귀 검증용.
- [x] **First End-to-End Smoke Test** — worker boot → claim → Publisher → complete API →
      DB 동기화 풀패스 검증. AUTH_FAILED case 까지 완전 정상 동작. 실 발행은 Phase 2 시점
      이미 입증.
- [x] **COLLECT_METRIC 자동 upsert** (commit `8df0caa`) — Collector 결과를 stdout 로그
      로만 남기던 TODO 제거. 신규 worker 엔드포인트 `/api/sc/metrics/[deploymentId]/worker`
  - `reportMetrics` 헬퍼. metrics 보고 실패는 collect job 자체를 FAILED 처리하지 않음
    (다음 sweep 에서 재시도). 단위 테스트 2건 추가.

### Phase 3 이후 운영 후속 (외부 의존 / 별도)

- [ ] Bridge ACP 라우트 (`POST /sales-content/generate` + `GET /health`) — `claude-code-bridge` 프로젝트
- [ ] Threads API 실구현 (Meta OAuth 앱 승인 대기)
- [ ] `docs/sales-content-operations.md` — 맥미니 워커 운영 가이드 (세션 만료 재발급 절차, ENCRYPTION_KEY/WORKER_API_KEY 셋업, smoke·db-stats 사용법, AUTH_FAILED 알림)
- [ ] Gemini 이미지 AI 검증 — `GOOGLE_AI_API_KEY` 셋업 후 실 호출 테스트
- [ ] AUTH_FAILED 발생 시 운영 알림(Slack 등) 훅

## 확정된 의사결정

| 항목               | 결정                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Deck key           | `sales-content` (API: `/api/sc/*`, 경로: `/d/sales-content/*`, 코드 약어: `sc`)                       |
| 상품 데이터 소스   | 독립 `B2BProduct` 엔터티 (InvProduct와 분리, `sourceInvProductId nullable`만 예약)                    |
| 텍스트 AI          | Claude Code ACP(1순위) + Ollama(fallback) — 외부 LLM API 직접 호출 없음                               |
| 이미지 AI          | Gemini API (Imagen/Nano Banana)                                                                       |
| 이미지 쿼터        | 워크스페이스 월 50장 하드 캡 (`WorkspaceAiCredit`)                                                    |
| **DQ1 (ACP 통신)** | **기존 Claude Code Bridge(port 18800) 확장** — 새 라우트(예: `/sales-content/generate`) 추가          |
| MVP 범위           | 자동 퍼블리싱·성과 수집 **포함** (Phase 1) — API 우선 + 브라우저 자동화 fallback (맥미니 24/7 worker) |
| 리치 텍스트        | TipTap (Unit 6에서 설치)                                                                              |
| 배포 큐            | DB-backed `SalesContentJob` (Redis·BullMQ 없음)                                                       |

## 미결정 (다음 단위 착수 전 확정 필요)

- **DQ3** — 초기 자동 배포 채널 우선순위 (Unit 10 착수 전)
  - 제안 기본안: Threads API + 네이버 블로그 브라우저 자동화
  - 플랫폼 API 가능/불가 리스트는 plan의 "External References" 섹션 참조

## Unit 3 이후 알아둘 외부 상태

- **Bridge 라우트 미구현**: DQ1 결정은 "옵션 A: Bridge(port 18800) 확장"이지만, Bridge 서비스 쪽에 `POST /sales-content/generate` 와 `GET /health` 라우트가 아직 없다. 따라서:
  - `/api/sc/ai/generate-text` 호출 시 ACP healthcheck 실패 → factory 가 Ollama 로 자동 fallback.
  - 로컬에 Ollama 도 안 떠 있으면 502 로 떨어지고 `TextGenerationLog` 에 FAILED 로 기록된다.
  - Bridge 확장은 이 repo 바깥 작업 (`~/.claude/CLAUDE.md` 의 Bridge 섹션 참조). Unit 4 end-to-end 검증 전에 Bridge 쪽 라우트 추가 필요.
- **Gemini API Key 미설정**: `.env.local` 에 `GOOGLE_AI_API_KEY` 추가 안 됨 → `/api/sc/ai/generate-image` 는 503 반환. 실제 이미지 테스트는 AI Studio 키 발급 후.
- **Space 단위 provider override deferred**: plan line 551 에서 언급된 DB 플래그 기반 override 는 현재 환경변수만 지원. 사용자 요구 시 `Space.aiProviderOverride` 컬럼 추가로 충분.
- **Repo-wide jest 설정 없음**: `src/lib/__tests__/*` 기존 테스트도 `npm test` 로 실행 불가 (babel-jest 가 TS 문법 인식 못 함). Unit 3 에서 작성한 `credit.test.ts`, `text-claude-code-acp.test.ts` 도 같은 이유로 실행 보류. 별도 인프라 유닛에서 `next/jest` preset 또는 `ts-jest` 설정을 추가해야 한다.

## 환경 셋업 (새 세션 시작 시)

워크트리가 새로 깔린 경우:

```bash
npm install
cp /Users/kaleos/projects/workdeck-app/.env.local .
npx prisma generate
npx prisma migrate deploy   # Unit 2 + Unit 3 migration 은 dev DB 에 이미 적용됨. 새 migration 이 생기면 다시 실행.
npm run build               # 타입·빌드 검증
npm run dev
```

Unit 3 추가 변수 (`.env.local.example` 참조) — 모두 optional, 값 없으면 해당 기능만 비활성:

```
CLAUDE_CODE_ACP_ENDPOINT=http://127.0.0.1:18800
OLLAMA_ENDPOINT=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
GOOGLE_AI_API_KEY=           # Gemini Imagen, AI Studio 키
GEMINI_IMAGE_MODEL=imagen-4.0-generate-001
SALES_CONTENT_IMAGE_MONTHLY_QUOTA=50
```

**DeckInstance 활성화:** 실제로 `/d/sales-content`에 접근하려면 현재 Space에 `DeckInstance(spaceId, deckAppId='sales-content', isActive=true)` 레코드가 필요합니다. `/my-deck` UI에서 활성화하거나 DB 직접 INSERT.

## 다른 Deck과의 병행 개발 상황

- `develop` 브랜치 (원래 디렉토리 `/Users/kaleos/projects/workdeck-app`) 에 **shipping(seller-hub) 관련 WIP**가 uncommitted 상태로 있음. 다른 작업자가 진행 중.
- feat/sales-content-deck (이 워크트리) 는 그 WIP와 독립적으로 커밋됨. 단, `prisma/schema.prisma`와 `src/generated/prisma/*`는 Unit 2 커밋 시점에 shipping hunk도 섞여 들어갔을 가능성 있음 → PR 머지 시점에 develop의 shipping 변경과 3-way merge로 자연 병합.
- 충돌 위험 파일에 수정 시 **주석 블록(`// ─── <Deck 이름> ───`)**으로 영역 구분 (sidebar.tsx, schema.prisma, seed.ts 등).

## Unit 5 구현 지침 (다음 착수) — 템플릿 시스템

**Goal:** 채널별 기본 템플릿 시스템 + 사용자 커스텀 저장. Unit 6 콘텐츠 제작의 기반.

**Requirements:** R3

**Dependencies:** Unit 1.

**Files:**

- Modify: `prisma/schema.prisma` — `Template { id, spaceId?(nullable=system), name, slug, kind('blog'|'social'|'cardnews'), sections(Json), isSystem }`, `Channel { platform, kind, publisherMode, collectorMode }` 기본 필드.
- Modify: `prisma/seed.ts` — 시스템 템플릿 3종 (블로그 장문 · 소셜 텍스트 · 카드뉴스) seed. 존재 시 upsert.
- Create: `src/lib/sc/template-engine.ts` — 템플릿 구조 zod + skeleton 렌더 유틸.
- Create: `app/api/sc/templates/{route,[id]/route}.ts`, `app/api/sc/channels/{route,[id]/route}.ts`.
- Create: `src/components/sc/templates/{template-list,template-form,template-preview}.tsx`, `src/components/sc/channels/channel-form.tsx`.
- Create: `app/d/sales-content/templates/{page,[id]/page,new/page}.tsx`, `app/d/sales-content/channels/{page,[id]/page}.tsx`.
- Test: `src/lib/sc/__tests__/template-engine.test.ts`.

**Approach:**

- `Template.sections: [{ key, kind: 'text'|'imageSlot'|'cta', label, guidance, constraints }]`. 카드뉴스는 `slides[]` 구조.
- `isSystem=true` 직접 수정 금지 (403). 복제해서 사용자 소유로 저장 가능.
- Channel 의 `publisherMode` / `collectorMode` 는 Unit 9~11 에서 실제 사용됨 — Unit 5 는 데이터 모델·UI 만.

**착수 전 확인:**

- 시스템 템플릿 seed 전략: `spaceId=null` 로 구분 vs 별도 플래그. plan 권장은 `isSystem` 플래그 + `spaceId=null`.
- 사이드바 "콘텐츠 제작 · 템플릿" 항목 활성화 대상.

## 과거 Unit 3 구현 지침 (완료 — 참고용)

**파일:**

- 신규: `src/lib/ai/providers/{index,text-claude-code-acp,text-ollama,image-gemini}.ts`
- 신규: `src/lib/ai/credit.ts` (`reserveImageCredit`, `commitImageCredit`, `refundImageCredit`, `getMonthUsage`)
- 신규: `app/api/sc/ai/{generate-text,generate-image,credit}/route.ts`
- 수정: `prisma/schema.prisma` — `WorkspaceAiCredit`, `ImageGenerationLog` 모델 추가 (필요시 `TextGenerationLog`도)
- 수정: `.env.local.example` — `CLAUDE_CODE_ACP_ENDPOINT`(예: `http://127.0.0.1:18800`), `OLLAMA_ENDPOINT`, `GOOGLE_AI_API_KEY`, `SALES_CONTENT_IMAGE_MONTHLY_QUOTA=50`
- 신규: `src/lib/ai/__tests__/credit.test.ts` — 크레딧 reserve→commit→refund 플로우
- 설치: `npm i @google/generative-ai`

**구현 핵심:**

- `TextProvider` 인터페이스: `name`, `generate({system, messages, responseFormat, maxTokens})` → `{content, usage}`
- `ClaudeCodeACPProvider`: `fetch(process.env.CLAUDE_CODE_ACP_ENDPOINT + '/sales-content/generate', ...)` — Bridge 라우트는 **Bridge 서비스 코드에서 별도 추가 필요** (이 repo 외부)
- `OllamaProvider`: `fetch(process.env.OLLAMA_ENDPOINT + '/api/chat', ...)` 표준 스펙
- Factory에서 헬스체크 실패 시 Ollama fallback
- `ImageGemini`: `@google/generative-ai`의 Imagen/Nano Banana, 결과 바이트 반환 (저장은 Unit 7의 Supabase Storage 책임)
- Credit 2-phase: reserve (imageUsed++) → commit (확정) / refund (롤백). 월 quota 초과 시 403 `CREDIT_EXCEEDED`.

**테스트 시나리오** (계획서 그대로):

- Happy: ACP 정상 → Claude 응답
- Edge: ACP 헬스체크 실패 → Ollama fallback
- Error: Gemini 5xx → reserved credit 롤백
- Error: 크레딧 소진 → 403
- Integration: Unit 4·6에서 호출 시 DB에 기록

**Migration 전략:** Unit 2와 동일하게 `--create-only` 불가 → `prisma/migrations/<timestamp>_feat_sales_content_ai/migration.sql` 수동 작성 후 `prisma migrate deploy`.

## 남은 Unit (Phase 1)

4~13. Plan 문서 `## Implementation Units` 섹션 참조. 의존 그래프: 1→(2,3,5)→4→6→(7,8)→(9,11)→(10,12)→13.

## 참고 파일 빠른 링크

- 전체 계획: [docs/plans/2026-04-24-001-feat-b2b-marketing-deck-plan.md](docs/plans/2026-04-24-001-feat-b2b-marketing-deck-plan.md)
- Seller-hub 레퍼런스 패턴:
  - [app/d/seller-hub/layout.tsx](app/d/seller-hub/layout.tsx)
  - [app/api/sh/brands/route.ts](app/api/sh/brands/route.ts) (API CRUD 패턴)
  - [src/lib/sh/schemas.ts](src/lib/sh/schemas.ts) (Zod 패턴)
- 인증 헬퍼: [src/lib/api-helpers.ts](src/lib/api-helpers.ts)
- 암호화: [src/lib/del/encryption.ts](src/lib/del/encryption.ts), [worker/src/encryption.ts](worker/src/encryption.ts)
- Worker 패턴 (Unit 9~12에서 재사용): [worker/src/orchestrator.ts](worker/src/orchestrator.ts), [worker/src/inventory-collector.ts](worker/src/inventory-collector.ts), [worker/src/api-client.ts](worker/src/api-client.ts)
- 기존 Bridge 서비스: `~/.claude/CLAUDE.md`의 "Claude Code Bridge" 섹션 참조 (port 18800)

## 새 세션 시작 프롬프트 제안

새 Claude Code 세션에서 첫 메시지로 이렇게 말씀하시면 됩니다:

> HANDOFF.md 읽고 Unit 2 migration이 아직 안 적용됐으면 먼저 적용 안내해주고, 그 다음 Unit 3부터 이어서 진행해줘.

또는 migration이 이미 적용됐다면:

> HANDOFF.md 읽고 Unit 3(AIProvider 어댑터)부터 이어서 진행해줘.

---

이 문서는 세션 간 인수인계 전용입니다. 작업이 진전되면 완료 섹션을 업데이트하고, Phase 1 전체 종료 후 삭제하거나 `docs/sales-content-progress.md`로 승격하세요.
