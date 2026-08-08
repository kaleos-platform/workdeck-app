# 세일즈 콘텐츠 온보딩 — 리소스 기반 AI 정보 세팅

사용자가 이미 보유한 자료(홈페이지 URL·문서 파일)를 받아 AI가 브랜드 프로필·상품·페르소나 초안을 만들고,
사용자가 검토·수정해 저장하는 온보딩 플로우.

## 진입점

- 위저드: `/d/sales-content/onboarding` (5스텝)
- 홈 진행률 카드: `/d/sales-content/home` 상단 — 미완료·미dismiss일 때만 표시

## 데이터 모델

| 모델 | 용도 |
|---|---|
| `SalesContentOnboarding` (spaceId unique) | `draft`(AI 초안 JSON), `draftStatus`(GENERATING/READY/FAILED), `completedAt`, `dismissedAt` |
| `ScOnboardingResource` | 사용자 리소스. `kind`(URL/FILE), `sourceUrl`/`storagePath`, `extractedText`, `status`(PENDING/DONE/FAILED) |
| `BrandProfile.logoUrl` | 회사 로고 1장 |

마이그레이션: `prisma/migrations/20260808000000_sc_onboarding`

**dismiss는 `Space.onboardingDismissedAt`을 쓰지 않는다** — 그 필드는 seller-hub 온보딩 카드가 점유 중이라
공유하면 두 덱의 카드가 함께 닫힌다. 세일즈 콘텐츠는 `SalesContentOnboarding.dismissedAt`로 격리한다.

## 스토리지 (운영 준비 필수)

`sales-content-files` 버킷을 **환경별로 Supabase 대시보드에서 수동 생성**해야 한다 (local / preview / prod).

- 이름: `sales-content-files`
- public: **false** (서명 URL 다운로드만 — `getPublicUrl` 사용 금지)
- file size limit: 10 MB

버킷이 없으면 문서 업로드 시 "Bucket not found"가 난다. 로고는 기존 public 버킷 `sales-content-assets`의
`{spaceId}/brand/logo-*.{ext}` 경로에 저장한다.

관련 유틸: `src/lib/sc/onboarding/storage.ts`

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET/POST /api/sc/onboarding/resources` | 목록 / URL 크롤(JSON `{kind:'URL',url}`) · 파일 업로드(multipart `file`). 최대 10개 |
| `DELETE /api/sc/onboarding/resources/[id]` | 삭제 (스토리지 파일 best-effort 정리) |
| `POST /api/sc/onboarding/generate` | 리소스 텍스트 → LLM JSON 초안. zod 검증 실패 시 1회 재시도 |
| `GET/PATCH /api/sc/onboarding/status` | 진행률 counts + completed/dismissed / `{dismissed:true}`·`{completed:true}` |
| `POST /api/sc/onboarding/logo` | 로고 업로드 → `BrandProfile.logoUrl` |

초안 저장은 전용 API 없이 기존 CRUD를 재사용한다 — `PUT /api/sc/brand-profile`, `POST /api/sc/products`,
`POST /api/sc/personas`.

## 파이프라인

1. **URL** — `src/lib/bo/crawler.ts`의 `crawlHomepage` 재사용(SSRF 방어: DNS 핀 고정 + 리다이렉트 hop별 재검증).
   크롤 실패도 FAILED 리소스로 기록해 사용자가 원인을 보고 삭제·재시도할 수 있게 한다.
2. **FILE** — 업로드 후 `unpdf`로 텍스트 추출(`src/lib/sc/onboarding/extract.ts`). v1은 PDF·txt만 추출하고
   docx/ppt/hwp는 파일만 보관(FAILED + 안내 메시지). 스캔 이미지형 PDF는 텍스트가 0이라 FAILED 처리된다.
3. **생성** — `extractedText` 결합(최대 24,000자) → `generateTextWithFallback({responseFormat:'json'})` →
   `onboardingDraftSchema`(products ≤5, personas ≤3) 검증. 호출은 `TextGenerationLog`에 감사 기록된다.

전 구간 동기 처리다. `SalesContentJob` 큐는 쓰지 않는다 — generate는 `maxDuration = 120`, resources는 60.
타임아웃이 잦아지면 `SalesContentJobKind`에 항목을 추가해 큐로 옮길 수 있다(모델 구조는 그대로 호환).

## 위저드 스텝

1. 자료 등록 — URL·문서·로고 업로드, 리소스 목록/상태
2. AI 초안 생성 — 추출 완료 리소스 0개면 비활성, 재생성 가능
3. 브랜드 프로필 — 기존 값 우선 프리필, 초안이 다르면 "AI 제안" 배지로 병기(클릭 시 적용) → PUT
4. 상품·페르소나 — 초안 체크박스 선택 + 인라인 수정 → 선택분만 POST(기존 데이터를 덮어쓰지 않고 추가)
5. 배포 채널 — 채널 관리 링크 + 온보딩 완료

모든 스텝에 건너뛰기가 있다. 이미 정보를 세팅한 워크스페이스도 진입해 원하는 스텝만 쓸 수 있다.
