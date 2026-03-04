# Workdeck 배포 계획서 v2

**업데이트:** 2026-03-04 | **현재 상태:** Phase 2 완료 → Phase 3 진행 예정

---

## 1. 현황 요약

| 항목             | 값                                                                  |
| ---------------- | ------------------------------------------------------------------- |
| 서비스 URL       | `https://app.workdeck.work`                                         |
| 레포             | `kaleos-platform/workdeck-app` (main)                               |
| 프레임워크       | Next.js 16.1.6 (App Router) + Prisma 7 + Supabase Auth              |
| DB (prod)        | Supabase `workdeck-prod` (ap-northeast-2)                           |
| DB (dev/preview) | Supabase `workdeck-dev`                                             |
| Vercel           | 개인 계정 (`eddy.sangwon@gmail.com`) — Production=prod, Preview=dev |
| 모니터링         | Sentry Kaleos 조직 / `workdeck-app` 프로젝트                        |

### 계정 구조

| 계정                     | 역할                                        |
| ------------------------ | ------------------------------------------- |
| `eddy.sangwon@gmail.com` | 개발 작업, Vercel 소유                      |
| `devops@kaleos.co.kr`    | GitHub 조직, Supabase, Stripe (법인 인프라) |
| `devops@workdeck.work`   | Sentry Admin, 도메인, 서비스 운영           |

> Google Cloud OAuth 앱은 개인 계정 소유 유지 (Redirect URI만 추가). 법인 이전은 팀 합류 시점에 진행.

---

## 2. 아키텍처

### 데이터 모델

```
User (Supabase Auth UUID)
 └── SpaceMember (OWNER | ADMIN | MEMBER)
      └── Space (테넌트 단위)
           └── DeckInstance (활성 카드)
                └── DeckApp ('coupang-ads' | 'osmu' | 'commerce-ops')

Workspace (기존 — 병행 운영 중, 점진 전환)
 └── AdRecord, ReportUpload, DailyMemo, KeywordStatus, ProductStatus, CampaignTarget
```

### 라우팅 구조 (목표)

```
/my-deck              → 내 카드 목록 홈
/d/[deckKey]          → 카드 진입점 (coupang-ads → /dashboard)
/space/[spaceId]      → 공간 설정
/billing              → 구독 관리 (Phase 5)
/api/spaces           → Space + DeckInstance 목록
/api/stripe/*         → Checkout / Webhook / Portal (Phase 5)
```

### 보안 원칙

- `spaceId`는 서버에서 재계산, 요청 바디 직접 입력 금지
- `assertSameSpace()`: cross-space 통신 403 차단
- Prisma는 서비스 롤(`DATABASE_URL`)로 연결 → RLS는 anon key 직접 접근 방어용

---

## 3. Phase 진행 현황

| Phase | 내용                                                      | 상태        |
| ----- | --------------------------------------------------------- | ----------- |
| 0-A   | 조직 계정 이전 (GitHub, Supabase, Sentry)                 | ✅ 완료     |
| 0-B   | 도메인 + Vercel 환경변수 분리                             | ✅ 완료     |
| 1     | Space/SpaceMember/DeckApp/DeckInstance 모델 + 백필        | ✅ 완료     |
| **2** | **Core OS 레이어 (resolveDeckContext, RBAC, MeterEvent)** | **✅ 완료** |
| **3** | **앱 셸 UI (/my-deck, /d/[deckKey])**                     | **✅ 완료** |
| **4** | **RLS 설정**                                              | **⬜ 다음** |
| 5     | Stripe 결제 연동 + /billing **(PoC 검증 후)**             | ⬜ 대기     |
| 6     | 마케팅 사이트 분리 (workdeck.work, 별도 레포)             | ⬜ 별도     |

**총 예상**: MVP(Phase 4까지) 10~17일 + Stripe(Phase 5) 5~7일

---

## 4. Phase 2: Core OS 레이어 전환 (3~5일)

**목표**: `resolveWorkspace()` → `resolveDeckContext()` 점진 전환 + RBAC + MeterEvent

### 4-1. `resolveDeckContext()` (`src/lib/api-helpers.ts`)

```typescript
export async function resolveDeckContext(deckKey = 'coupang-ads') {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: { space: { select: { id: true, currentPlan: true, name: true } } },
  })
  if (!membership) return { error: errorResponse('공간이 없습니다', 404) }

  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId: membership.space.id, deckAppId: deckKey } },
  })
  if (!deckInstance?.isActive) return { error: errorResponse('카드가 활성화되지 않았습니다', 403) }

  return { user, space: membership.space, role: membership.role }
}
```

> `resolveWorkspace()`는 점진 전환 기간 동안 그대로 유지.

### 4-2. RBAC 가드 (`src/lib/api-helpers.ts`)

```typescript
const ROLE_HIERARCHY = { OWNER: 3, ADMIN: 2, MEMBER: 1 }

export function assertRole(userRole: SpaceMemberRole, required: SpaceMemberRole) {
  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[required])
    return errorResponse('권한이 없습니다', 403)
  return null
}

export function assertSameSpace(sourceId: string, targetId: string) {
  if (sourceId !== targetId) return errorResponse('cross-space 통신은 허용되지 않습니다', 403)
  return null
}
```

### 4-3. 사용량 미터링 (`src/lib/meter.ts`)

```typescript
type MeterEventType = 'report_generated' | 'upload_processed' | 'analysis_run'

export async function trackMeterEvent(
  spaceId: string,
  deckAppId: string,
  eventType: MeterEventType,
  quantity = 1
) {
  await prisma.meterEvent.create({ data: { spaceId, deckAppId, eventType, quantity } })
}
```

업로드 API 완료 후: `await trackMeterEvent(space.id, 'coupang-ads', 'upload_processed')`

### 완료 조건

- [ ] `resolveDeckContext('coupang-ads')` → 기존 API 동일 동작
- [ ] MEMBER 역할로 ADMIN 전용 API 접근 시 403
- [ ] 업로드 완료 후 `MeterEvent` 레코드 생성

---

## 5. Phase 3: 앱 셸 UI 구현 (3~5일)

**목표**: My Deck 홈 + Deck 진입 라우트 (빌링 UI는 Phase 5)

### 신규 라우트

```
app/my-deck/page.tsx          → 내 카드 목록 + 공간 선택
app/d/[deckKey]/page.tsx      → 카드 진입 (coupang-ads → /dashboard redirect)
app/api/spaces/route.ts       → GET: Space + DeckInstance 목록
```

### Sidebar 업데이트 (`src/components/layout/sidebar.tsx`)

```
[My Deck 홈]     → /my-deck
[쿠팡 광고 관리] → /dashboard (기존)
[공간 설정]      → /space/[spaceId]
```

> 빌링 링크는 Phase 5 완료 후 추가

### 완료 조건

- [ ] `/my-deck` → 활성 카드 목록 표시
- [ ] `/d/coupang-ads` → 캠페인 대시보드 정상 진입

---

## 6. Phase 4: RLS 설정 (1~2일)

**목표**: Supabase DB 레벨 보안 (anon key 직접 접근 방어)

```sql
-- Workspace 기반 테이블
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyMemo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeywordStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignTarget" ENABLE ROW LEVEL SECURITY;

-- Space 기반 테이블
ALTER TABLE "Space" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MeterEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_owner_only" ON "Workspace"
  FOR ALL USING ("ownerId" = auth.uid());

CREATE POLICY "space_member_only" ON "Space"
  FOR ALL USING (id IN (SELECT "spaceId" FROM "SpaceMember" WHERE "userId" = auth.uid()));
```

### 완료 조건

- [ ] Supabase Table Editor에서 RLS Enabled 표시
- [ ] anon key 직접 조회 시 빈 결과
- [ ] 앱 정상 동작 유지 (서비스 롤 우회)

---

## 7. Phase 5: Stripe 결제 연동 (5~7일) — PoC 검증 후

> **시작 조건**: Phase 3 완료 후, 여러 카드(coupang-ads, osmu 등) PoC 사용성 검증이 완료된 시점.

### 과금 플랜

| 플랜    | 월 요금  | 주요 제한                        |
| ------- | -------- | -------------------------------- |
| FREE    | 0원      | 업로드 3회/월, 분석 제한         |
| Starter | ₩39,000  | 업로드 30회/월, 키워드·상품 분석 |
| Pro     | ₩99,000  | 업로드 150회/월, 내보내기, 알림  |
| Team    | ₩199,000 | 무제한 (Phase 5 이후 추가)       |

MVP에서 **Starter/Pro 2개 플랜만** 구현.

### API 라우트

```
app/api/stripe/checkout/route.ts  POST: Checkout 세션 생성
app/api/stripe/webhook/route.ts   POST: 이벤트 수신 (서명 검증 필수)
app/api/stripe/portal/route.ts    POST: Customer Portal 세션 생성
app/billing/page.tsx              플랜 정보 + 업그레이드 + Customer Portal
```

### Webhook 처리 이벤트

```
checkout.session.completed      → Space.stripeCustomerId/SubscriptionId/currentPlan 업데이트
customer.subscription.updated   → Space.currentPlan 업데이트
customer.subscription.deleted   → Space.currentPlan = FREE
invoice.payment_failed          → 사용자 이메일 알림
```

### Feature Gating (`src/lib/entitlement.ts`)

```typescript
const PLAN_FEATURES: Record<PlanType, string[]> = {
  FREE: ['basic_dashboard'],
  STARTER: ['basic_dashboard', 'keyword_analysis', 'product_analysis', 'upload_30'],
  PRO: [
    'basic_dashboard',
    'keyword_analysis',
    'product_analysis',
    'upload_150',
    'export',
    'alerts',
  ],
  TEAM: ['*'],
}
export const hasFeature = (plan: PlanType, feature: string) =>
  PLAN_FEATURES[plan].includes('*') || PLAN_FEATURES[plan].includes(feature)
```

### Stripe Dashboard 설정

1. Products 3개 생성 (Starter/Pro/Team, trial 14일)
2. Stripe Tax → Korea KR 10% VAT 활성화
3. Customer Portal 활성화
4. Webhook Endpoint: `https://app.workdeck.work/api/stripe/webhook`

### 완료 조건

- [ ] Stripe Test 카드 결제 → `Space.currentPlan` 업데이트
- [ ] Webhook 서명 검증 실패 시 400
- [ ] 구독 취소 → `currentPlan = FREE`
- [ ] Customer Portal 접속 가능
- [ ] `/billing` → 플랜 정보 + Customer Portal 버튼

---

## 8. Phase 6: 마케팅 사이트 분리 (별도 레포, 기간 미정)

- 새 레포: `workdeck-web` (Next.js)
- 도메인: `workdeck.work` (현재 `app/(marketing)/` 임시 유지)
- 구조: `/` 메인, `/kr/cards/coupang-ads`, `/blog/[slug]`
- hreflang: ko/ja/en 다국어 대응

---

## 9. 환경변수

```bash
# Supabase (Production=prod, Preview=dev)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=          # Transaction pooler (포트 6543) — 앱 런타임
DIRECT_URL=            # Session pooler (포트 5432) — Prisma migrate

# 앱
NEXT_PUBLIC_APP_URL=https://app.workdeck.work

# Sentry
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=            # kaleos
SENTRY_PROJECT=workdeck-app
SENTRY_AUTH_TOKEN=

# Stripe (Phase 5 이후 추가)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_TEAM=
```

---

## 10. 완료 체크리스트

### Phase 0-A (조직 계정 이전) ✅

- [x] GitHub `kaleos-platform/workdeck-app` Transfer + 로컬 remote 업데이트
- [x] Supabase workdeck-dev / workdeck-prod 생성 + 환경변수 수집
- [x] Vercel: kaleos-platform/workdeck-app 재연결, Production/Preview 환경변수 분리
- [x] Google OAuth redirect URI 각 Supabase 프로젝트 등록
- [x] Sentry Kaleos 조직 생성, workdeck-app 프로젝트, DSN 환경변수 반영
- [x] `npm run build` 통과
- [ ] Google Cloud OAuth 앱 `devops@kaleos.co.kr`로 이전 (팀 합류 시)

### Phase 0-B (인프라 기반) ✅

- [x] `https://app.workdeck.work` 정상 접속
- [x] Google OAuth → `/auth/callback` 정상 처리
- [x] Vercel Production/Preview 환경변수 분리 확인

### Phase 1 (데이터 모델 확장) ✅

- [x] `prisma migrate deploy` 성공 (workdeck-dev + workdeck-prod)
- [x] DeckApp 시드: coupang-ads / osmu / commerce-ops
- [x] Workspace → Space 백필 (prod: 1=1 일치)
- [x] `npm run build` 통과, Vercel 프로덕션 READY

### Phase 2 (Core OS 레이어) ✅

- [x] `resolveDeckContext('coupang-ads')` 구현 (`src/lib/api-helpers.ts`)
- [x] `assertRole()` / `assertSameSpace()` RBAC 가드 구현
- [x] `trackMeterEvent()` 구현 (`src/lib/meter.ts`)
- [x] 업로드 API에 MeterEvent 연동 (`upload_processed`)

### Phase 3 (앱 셸 UI) ✅

- [x] `/my-deck` → 활성 카드 목록 표시
- [x] `/d/coupang-ads` → 캠페인 대시보드 정상 진입

### Phase 4 (RLS) ⬜

- [ ] Supabase Table Editor에서 RLS Enabled 표시
- [ ] anon key 직접 조회 시 빈 결과
- [ ] 앱 정상 동작 유지

### Phase 5 (Stripe, PoC 검증 후) ⬜

- [ ] Stripe Test 카드 결제 → `Space.currentPlan` 업데이트
- [ ] Webhook 서명 검증 실패 시 400
- [ ] 구독 취소 → `currentPlan = FREE`
- [ ] Customer Portal 접속 가능
- [ ] `/billing` → 플랜 정보 + Customer Portal 버튼
