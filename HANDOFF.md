# Sales Content Deck — 인수인계 (2026-04-24, 업데이트)

> 이전 Claude Code 세션(`/Users/kaleos/projects/workdeck-app`, develop 브랜치)에서 이어지는 작업입니다.
> 새 세션 시작 시 **가장 먼저 이 문서를 읽고** 이어가세요. 이 파일 자체는 git에 커밋하지 않아도 됩니다 (필요 시 .gitignore 추가).

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

**다음:**

- [ ] Unit 4 — 아이데이션 (글감 후보 생성)

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

## Unit 4 구현 지침 (다음 착수) — 아이데이션 (글감 후보 생성)

**Goal:** 세팅값(B2BProduct · Persona · BrandProfile · 활성 ImprovementRule) + 사용자 프롬프트 → Claude Code ACP 로 글감 후보 N개 생성.

**Requirements:** R2, R15 (규칙 주입 지점)

**Dependencies:** Unit 2 (세팅 데이터), Unit 3 (AIProvider).

**Files:**

- Modify: `prisma/schema.prisma` — `ContentIdea { id, spaceId, promptInput, productId?, personaId?, output(json), generatedBy(USER|AI), promptTraceHash, createdAt }` + 관련 enum 필요 시.
- Create: `src/lib/sc/prompts.ts` — ideation prompt builder (활성 ImprovementRule 병합 포함).
- Create: `app/api/sc/ideations/route.ts`, `[id]/route.ts`.
- Create: `src/components/sc/ideation/{ideation-form,idea-card,idea-list}.tsx`.
- Create: `app/d/sales-content/ideation/{page,[id]/page}.tsx`.
- Test: `src/lib/sc/__tests__/prompts.test.ts`.

**Approach:**

- Unit 3 의 `generateTextWithFallback` 을 직접 호출 (API 라우트 경유 아님 — 서버 내부).
- `responseFormat: 'json'` 지시 + JSON schema 를 system prompt 에 명시.
- `promptTrace` 는 (builder hash, rule id 목록) 스냅샷을 저장해 규칙 변경 후 재현 가능.

**착수 전 확인:** Bridge 쪽 `POST /sales-content/generate` 라우트가 준비돼 있어야 실제 호출이 된다. 없으면 Unit 4 는 UI/DB 만 구현하고 실제 AI 호출은 Ollama (로컬) 로 검증.

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
