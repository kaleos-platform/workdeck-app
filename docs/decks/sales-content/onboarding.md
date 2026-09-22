# 세일즈 콘텐츠 온보딩 — 리소스 기반 AI 정보 세팅

사용자가 홈페이지·블로그 URL과 PDF·Markdown을 전달하면 브랜드 프로필·상품·고객 초안을 생성한다.
주요 고객은 한 칸으로 지정할 수 있으며 기업 ESG 담당자가 기본값이다. 사용자는 출처와 상세 정보를 검토한 뒤 한 번에 저장한다.

## 진입점

- 위저드: `/d/sales-content/onboarding` (자료 등록 → 자료 분석 → 검토·저장)
- 홈 진행률 카드: `/d/sales-content/home` 상단 — 미완료·미dismiss일 때만 표시

## 데이터 모델

| 모델                                      | 용도                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SalesContentOnboarding` (spaceId unique) | `draft`(AI 초안 JSON), `draftStatus`(GENERATING/READY/FAILED), `completedAt`, `dismissedAt`                |
| `ScOnboardingResource`                    | 사용자 리소스. `kind`(URL/FILE), `sourceUrl`/`storagePath`, `extractedText`, `status`(PENDING/DONE/FAILED) |
| `BrandProfile.logoUrl`                    | 회사 로고 1장                                                                                              |

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

| 엔드포인트                                 | 설명                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET/POST /api/sc/onboarding/resources`    | 목록 / URL 대기열 등록(JSON `{kind:'URL',url}`) · 파일 업로드(multipart `file`). 안전 상한 1,000건      |
| `POST /api/sc/onboarding/collect`          | `{}`로 URL 한 건 수집·연결된 상품/카테고리/소개 페이지 발견. `{resourceId}`로 실패한 URL 재시도         |
| `DELETE /api/sc/onboarding/resources/[id]` | 삭제 (스토리지 파일 best-effort 정리)                                                                   |
| `POST /api/sc/onboarding/generate`         | `{audience}`. 상품 한 건씩 분석·캐시 후 브랜드/고객 초안 생성. `done:false` 동안 다음 요청으로 이어간다 |
| `POST /api/sc/onboarding/save`             | 검토한 브랜드·선택한 상품/고객 저장, 완료 처리. transaction과 URL/이름 중복 검사로 재시도 안전성 확보   |
| `GET/PATCH /api/sc/onboarding/status`      | 진행률 counts + completed/dismissed / `{dismissed:true}`·`{completed:true}`                             |
| `POST /api/sc/onboarding/logo`             | 로고 업로드 → `BrandProfile.logoUrl`                                                                    |

기존 개별 설정 CRUD도 그대로 사용할 수 있다. 온보딩은 `/save`로 전체를 한 transaction에 저장한다.
이미 존재하는 상품·고객은 유지하며 생성 수와 건너뛴 수를 반환한다.

## 파이프라인

1. **URL** — `safeFetchHtml`의 DNS·리다이렉트 SSRF 방어를 재사용한다. 같은 사이트의 상품·카테고리·페이지 이동·소개 링크를 탐색한다. Cafe24 상품 URL의 category/display 변형을 정규화해 중복을 막는다. 네이버 모바일 목록은 공개 RSS로 대표 글 최대 20건을 발견하고 본문을 수집한다.
2. **FILE** — PDF는 `unpdf`, Markdown·txt는 UTF-8 텍스트로 추출한다. `.md`의 빈 MIME·text/plain도 처리한다. 텍스트를 읽을 수 없는 스캔형 PDF는 실패 안내를 표시한다. 문서 20,000자 초과 시 미분석 구간을 명시하고 분할 등록을 안내한다.
3. **상품 분석** — `extractedText`에 version 1 JSON envelope(페이지 유형·텍스트·이미지 URL·출처)를 보관한다. 상품별 `analysis: {audience,draft}`를 저장해 중지·재접속 시 재사용한다. 상세 이미지는 SSRF 방어 다운로드 → sharp 분할 → 워크스페이스 AI 공급자 입력을 거친다. SKU/상품을 5개로 제한하지 않는다.
4. **브랜드·고객** — 자료별 입력 예산을 나눠 뒤쪽 블로그가 통째로 잘리지 않게 한다. 브랜드 차별점·사례·문의 경로와 고객의 구매 목적·고민·의사결정 기준을 customFields에 보존한다. 고객 추론은 AI 제안으로 표시하고 인증·탄소저감 수치는 근거 없이 만들지 않도록 지시한다.
5. **저장** — 검토한 customFields를 포함해 한 번에 저장한다. 기존 브랜드는 기존 값으로 채우고 AI 제안은 사용자가 적용한다. 기존 상품·고객의 자동 덮어쓰기는 없다.

개별 요청은 동기 처리하며 브라우저가 collect/generate를 반복한다. 탭을 닫으면 새 요청은 멈추고, 재접속 후 계속할 수 있다. generate는 `maxDuration = 180`, resources/collect는 60이다. 별도 worker·DB migration은 없다.

## 범위와 한계

- 공개 페이지에서 연결된 전체 상품을 탐색한다. 로그인·봇 차단·JS 전용 상품 목록은 수집을 보장하지 않으며 실패와 한도 도달을 표시한다.
- 이미지 분석은 원본 최대 100개 후보, 64개 분할 이미지, 30MB 다운로드/12MB 모델 입력 및 다운로드 시간 상한을 적용한다. 누락/실패는 검토 화면에서 표시한다.
- 이미지는 정보 분석에만 사용하고 콘텐츠용 공개 에셋으로 자동 복사하지 않는다.
- 배포 채널과 로고는 선택 사항이다. 기존 상세 설정 페이지에서 이후 정보를 보완할 수 있다.
- 실제 공급자에 이미지 입력이 필요하다. SaaS 3종과 Codex CLI는 지원하며 다른 텍스트 전용 공급자는 명시적 오류로 안내한다.

수동 실서비스 분석 검증: `node scripts/verify-sales-content-import.cjs [URL]`. 환경의 Gemini 키를 사용해 공개 상품 한 건을 분석하며 DB를 변경하지 않는다.
