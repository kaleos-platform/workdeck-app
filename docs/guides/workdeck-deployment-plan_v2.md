# Workdeck 배포 및 운영 실행 계획서 v2

**작성일:** 2026-03-01
**상태:** 실행 준비 중
**기준 코드베이스:** `coupang-ad-manager` (현재 운영 중)

---

## 1. 개요

**Workdeck**는 "나만의 업무 카드를 꽂아 쓰는 Business OS"다. `coupang-ad-manager`는 이 OS의 첫 번째 카드(Coupang Ads Card)로, 현재 Vercel에 배포된 상태다. 본 계획서는 이 앱을 Workdeck 플랫폼으로 확장하기 위한 기술·운영 실행 계획을 담는다.

### 1-1. 도메인 정책

| 용도      | 도메인               | 설명                        |
| --------- | -------------------- | --------------------------- |
| 서비스 앱 | `app.workdeck.work`  | 로그인, My Deck, Deck 실행  |
| 마케팅/홈 | `workdeck.work`      | 홈페이지, Deck 랜딩, 블로그 |
| 문서      | `docs.workdeck.work` | 헬프/가이드                 |

### 1-2. 카드(Deck) 로드맵

| 카드명               | 내부 ID        | 우선순위 | 상태     |
| -------------------- | -------------- | -------- | -------- |
| 쿠팡 광고 자동화     | `coupang-ads`  | 1        | MVP 완료 |
| OSMU 광고 제작       | `osmu`         | 2        | 계획 중  |
| 이커머스 운영 자동화 | `commerce-ops` | 3        | 계획 중  |

---

## 2. 현재 상태 분석

### 2-1. 기술 스택

| 항목       | 현황                                          |
| ---------- | --------------------------------------------- |
| 프레임워크 | Next.js 16.1.6 (App Router)                   |
| 인증       | Supabase Auth (이메일 + Google OAuth) ✅      |
| DB         | Prisma 7 + PostgreSQL (Supabase)              |
| 배포       | Vercel (`coupang-ad-manager-iota.vercel.app`) |
| 모니터링   | Sentry (프로젝트명: `workdeck`) ✅            |
| 스타일     | Tailwind CSS v4 + shadcn/ui                   |

### 2-2. 현재 데이터 모델 (핵심)

```
User (1) ──→ (1) Workspace
Workspace ──→ AdRecord, ReportUpload, DailyMemo, KeywordStatus, ProductStatus, CampaignTarget
```

- **User 1:1 Workspace**: 현재 단일 사용자, 단일 워크스페이스 구조
- **워크스페이스 격리**: 모든 쿼리에 `workspaceId` 강제 포함 (서버 측 격리)
- **인증 헬퍼**: `resolveWorkspace()` → 인증 + 워크스페이스 소유권 검증

### 2-3. 갭 분석

| Workdeck 목표                  | 현재 코드              | 변경 필요          |
| ------------------------------ | ---------------------- | ------------------ |
| `Space` 테넌트 단위            | `Workspace` (1:1 User) | DB 확장 + 백필     |
| `SpaceMember` (역할 기반 권한) | 없음                   | 신규 모델          |
| `DeckApp` / `DeckInstance`     | 없음                   | 신규 모델          |
| `resolveDeckContext(deckKey)`  | `resolveWorkspace()`   | 점진 전환          |
| Stripe 구독/과금               | 없음                   | 전체 구현          |
| RLS (DB 레벨 보안)             | 미설정                 | Supabase 정책 추가 |
| `app.workdeck.work` 도메인     | Vercel 임시 URL        | DNS 설정           |

---

## 3. 목표 아키텍처

### 3-1. 계정/공간/Deck 모델

```
User
 └── SpaceMember (OWNER | ADMIN | MEMBER)
      └── Space (개인 공간 or 조직 공간)
           └── DeckInstance (활성화된 카드)
                └── DeckApp (카드 정의: coupang-ads, osmu, commerce-ops)
```

- **User**: Supabase Auth 사용자 (변경 없음)
- **Space**: 테넌트 단위 (기존 Workspace 대체 또는 병행)
- **SpaceMember**: 공간 멤버십 + 역할 (`OWNER | ADMIN | MEMBER`)
- **DeckApp**: 카드 앱 정의 카탈로그 (전역)
- **DeckInstance**: 특정 Space에서 활성화된 카드

### 3-2. 보안 원칙

- **same-space only**: Deck 간 통신은 동일 `spaceId` 내에서만 허용
- **서버 계산 spaceId**: 요청 바디의 `spaceId` 직접 입력 금지, 서버에서 재계산
- **assertSameSpace()**: 모든 cross-deck 통신에 spaceId 동일성 검증 강제

### 3-3. 라우팅 구조 (목표)

```
/my-deck                    → 내 카드 목록 홈
/space/[spaceId]            → 공간 대시보드
/d/[deckKey]                → 카드 진입점
/billing                    → 구독 관리
/api/spaces                 → Space 관련 API
/api/stripe/checkout        → Stripe Checkout 세션 생성
/api/stripe/webhook         → Stripe 이벤트 수신
/api/stripe/portal          → Customer Portal 세션 생성
```

---

## 4. 추가 고려사항 (v1 계획서에서 누락된 항목)

### 4-1. Stripe 관련 (critical)

| 항목                | 설명                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Webhook 이벤트 처리 | `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted` 반드시 처리 |
| Customer Portal     | 사용자 스스로 구독 변경/취소 (`/api/stripe/portal`)                                                 |
| Trial Period        | 14일 무료 체험 (`trial_period_days: 14`)                                                            |
| Feature Gating      | 플랜별 기능 잠금 로직 (미들웨어 + 서버 컴포넌트)                                                    |
| Stripe Tax          | 한국 VAT 10% 자동 처리 활성화                                                                       |
| 사용량 캡           | 초과 전 알림 + 월별 사용량 대시보드 필수                                                            |
| Metering 단위 정의  | "리포트 1회 생성", "데이터 업로드 1회" 명확화                                                       |

### 4-2. 데이터 마이그레이션 (critical)

- 기존 `Workspace`를 `Space(PERSONAL)` + `DeckInstance(coupang-ads)`로 자동 백필
- `Workspace` 모델은 삭제하지 않고 **병행 운영** → 점진 전환 (무중단)
- 백필 스크립트: `prisma/scripts/backfill-spaces.ts`

### 4-3. 보안 강화

- **RLS 활성화**: Supabase 대시보드에서 각 테이블별 정책 설정 (현재 서버 격리만)
- **Webhook 서명 검증**: `stripe.webhooks.constructEvent()` + `STRIPE_WEBHOOK_SECRET`
- **cross-space 차단**: 403 반환 + 보안 로그 기록

### 4-4. 레포지토리 구조 결정

| 옵션           | 설명                                              | 권장 시점            |
| -------------- | ------------------------------------------------- | -------------------- |
| 단일 레포 유지 | 현재 `coupang-ad-manager` 레포에 Workdeck OS 추가 | MVP 단계 (현재)      |
| 앱 분리        | `workdeck-app` + `workdeck-web` 분리              | 2번째 카드 개발 시점 |

### 4-5. Supabase 프로덕션 분리

현재 개발/프로덕션이 동일 Supabase 프로젝트 사용 → **즉시 분리 필요**

---

## 5. 단계별 구현 계획

---

### Phase 0-A. 조직 계정 이전 (0.5~1일)

**목표**: 개인 계정에서 Kaleos 조직 계정으로 프로젝트 이전
**전제 조건**: DB 데이터 유지 불필요 → 스키마 재적용 방식 채택

#### 계정 구조 및 역할 정의

| 구분             | 계정                   | 역할                                   |
| ---------------- | ---------------------- | -------------------------------------- |
| 개인 계정        | eddy.sangwon@gmail.com | 개인 개발 작업, Vercel 소유 (1인 단계) |
| 법인 인프라 계정 | devops@kaleos.co.kr    | 코드·DB·결제 등 법인 인프라 소유권     |
| 제품 운영 계정   | devops@workdeck.work   | 에러 모니터링·도메인·서비스 운영 관리  |
| 현재 팀 규모     | 1인 (Solo)             | 향후 팀 확장 가능성 대비               |

> **계정 분리 원칙**: `devops@kaleos.co.kr`(법인)이 인프라 자산을 소유하고, `devops@workdeck.work`(제품)이 서비스를 운영한다. 팀이 생겨도 이 구조가 유지된다.

#### 서비스별 계정 배분

| 서비스                         | 소유 계정                | 이유                                |
| ------------------------------ | ------------------------ | ----------------------------------- |
| **GitHub** (`kaleos-platform`) | `devops@kaleos.co.kr`    | 법인 코드 자산 — 이전 완료 ✅       |
| **Supabase**                   | `devops@kaleos.co.kr`    | DB = 법인 핵심 인프라 자산          |
| **Stripe**                     | `devops@kaleos.co.kr`    | 결제·정산 = 법인 명의 필수          |
| **Vercel**                     | `eddy.sangwon@gmail.com` | 1인 단계 무료 유지, 팀 합류 시 이전 |
| **Sentry**                     | `devops@workdeck.work`   | 에러 모니터링 = 제품 운영 도구      |
| **도메인** `workdeck.work`     | `devops@workdeck.work`   | 제품 브랜드 도메인                  |
| **도메인** `kaleos.co.kr`      | `devops@kaleos.co.kr`    | 법인 도메인                         |

#### 실제 로그인 흐름

```
개발 작업   → eddy.sangwon@gmail.com  (GitHub commit/push, Vercel 확인)
인프라 관리 → devops@kaleos.co.kr     (Supabase, Stripe, GitHub 조직 설정)
서비스 운영 → devops@workdeck.work    (Sentry, DNS, 고객 커뮤니케이션)
```

#### 서비스별 이전 전략 요약

| 서비스   | 전략                              | 소유 계정                |
| -------- | --------------------------------- | ------------------------ |
| GitHub   | 조직으로 Transfer — **완료** ✅   | `devops@kaleos.co.kr`    |
| Supabase | 조직에서 새 프로젝트 생성         | `devops@kaleos.co.kr`    |
| Vercel   | 개인 계정 유지 + 조직 레포 재연결 | `eddy.sangwon@gmail.com` |
| Sentry   | 조직 계정에서 새 프로젝트 생성    | `devops@workdeck.work`   |

> **Vercel 업그레이드 시점**: 팀원이 Vercel 대시보드에 직접 접근할 필요가 생길 때 Pro Team($20/월)으로 전환한다.

**이전 순서 원칙**: GitHub ✅ → Supabase → Vercel → Sentry
(Vercel이 GitHub 레포에 의존하므로 GitHub 이전 선행 필수)

---

#### 0-A-1. GitHub 조직(Organization) 생성 및 레포 이전

**Step 1 — GitHub 조직 생성** (미생성 시):

```
github.com → 우측 상단 '+' → New organization
→ Plan: Free (팀원 합류 전까지 무료로 충분)
→ Organization name: kaleos-platform  (또는 kaleos-io 등, 도메인과 일치 권장)
→ Contact email: devops@kaleos.co.kr
→ Owner: eddy.sangwon@gmail.com (개인 계정이 Owner로 관리)
```

**Step 2 — 레포 rename + Transfer**:

```
개인 계정 → coupang-ad-manager 레포 → Settings

1. General → Repository name → "workdeck-app" → Rename
2. Danger Zone → "Transfer repository"
   → 이전 대상: kaleos-platform (조직명 입력)
   → 확인 문자 입력 → Transfer
```

**Transfer 후 처리**:

```bash
# 로컬 remote URL 업데이트
git remote set-url origin https://github.com/kaleos-platform/workdeck-app.git
git remote -v  # 확인
```

**Transfer 특성 이해**:

- 개인 계정에 자동 리다이렉트(301) 60일간 유지 → 기존 clone URL 즉시 깨지지 않음
- Issues, PR, Wiki 등 모두 이전됨
- GitHub Actions, Dependabot secrets는 조직 Secrets로 수동 재설정 필요
- Vercel GitHub App 연동은 별도 재승인 필요 (0-A-3에서 처리)

---

#### 0-A-2. Supabase 조직 프로젝트 생성

**Step 1 — Supabase 조직 생성** (미생성 시):

```
app.supabase.com → devops@kaleos.co.kr 로 로그인 (또는 Google SSO)
→ New organization
→ Name: Kaleos
→ Plan: Free (2개 프로젝트 무료 제공)
```

**Step 2 — 프로젝트 2개 생성**:

| 구분     | 프로젝트명      | 용도                                   |
| -------- | --------------- | -------------------------------------- |
| 개발     | `workdeck-dev`  | 로컬 개발, Vercel Preview 브랜치       |
| 프로덕션 | `workdeck-prod` | Vercel Production, `app.workdeck.work` |

```
app.supabase.com → Kaleos 조직 선택 → New project
→ Name: workdeck-dev
→ Database Password: 강한 비밀번호 기록 (Password Manager 저장)
→ Region: Northeast Asia (ap-northeast-2)  ← 한국 사용자 최소 지연
→ Create new project (약 2~3분 소요)

※ workdeck-prod도 동일 방법으로 생성
```

**수집할 정보** (각 프로젝트 → Settings → API):

```
Project URL          → NEXT_PUBLIC_SUPABASE_URL
anon (public) key    → NEXT_PUBLIC_SUPABASE_ANON_KEY
```

**Settings → Database → Connection string → Transaction pooler/Session pooler**:

```
Transaction pooler (포트 6543) → DATABASE_URL   (앱 런타임용)
Session pooler     (포트 5432) → DIRECT_URL     (Prisma migrate용)
```

**Google OAuth 재설정** (각 Supabase 프로젝트에서):

```
Authentication → Providers → Google
→ Client ID / Secret: 기존 Google Cloud 앱 값 그대로 사용 가능
  (Google Cloud Console에서 OAuth 앱 소유는 개인 계정에 있어도 무관)
→ Authorized redirect URIs 추가:
    https://app.workdeck.work/auth/callback   (prod용)
    http://localhost:3000/auth/callback        (dev용, 자동 허용)
```

> **Google Cloud OAuth 앱**: 현재 개인 계정 소유인 채로 두어도 동작에 문제 없다.
> 조직 Google Workspace로 이전이 필요하면 hello@kaleos.co.kr Google Cloud Console에서 새 앱 생성 후 교체한다.

**기존 개인 Supabase 처리**:

```
새 프로젝트 정상 동작 확인 후
→ 기존 coupang-ad-manager 프로젝트 삭제
   (Settings → General → Delete project)
```

---

#### 0-A-3. Vercel — 개인 계정 유지 + 조직 레포 재연결

1인 개발 단계에서는 **개인 Vercel 계정(eddy.sangwon@gmail.com) 유지**가 비용 효율적이다.
GitHub 레포만 조직으로 이전했으므로 Vercel에서 새 레포 URL을 재연결한다.

**Step 1 — GitHub 조직 레포 접근 권한 부여**:

```
Vercel Dashboard → 우측 상단 아바타 → Settings → Integrations → GitHub
→ "Configure" → GitHub 권한 설정 페이지
→ 'kaleos-platform' 조직에 Vercel GitHub App 설치 승인
   (Organization access → kaleos-platform → Grant)
```

**Step 2 — 프로젝트 Git 재연결**:

```
Vercel → coupang-ad-manager 프로젝트 → Settings → Git
→ "Disconnect" (기존 개인 레포 연결 해제)
→ "Connect Git Repository"
→ kaleos-platform/workdeck-app 선택 → Connect
```

**Step 3 — 환경변수 업데이트**:

```
Settings → Environment Variables

Production 환경:
  NEXT_PUBLIC_SUPABASE_URL      = workdeck-prod URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY = workdeck-prod anon key
  DATABASE_URL                  = workdeck-prod Transaction pooler URL
  DIRECT_URL                    = workdeck-prod Session pooler URL
  NEXT_PUBLIC_APP_URL           = https://app.workdeck.work

Preview 환경:
  NEXT_PUBLIC_SUPABASE_URL      = workdeck-dev URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY = workdeck-dev anon key
  DATABASE_URL                  = workdeck-dev Transaction pooler URL
  DIRECT_URL                    = workdeck-dev Session pooler URL
```

**Step 4 — Vercel 프로젝트 이름 변경** (선택):

```
Settings → General → Project Name → "workdeck-app"
```

> **팀 확장 시 Vercel 업그레이드 시점**: 팀원이 Vercel 대시보드에 직접 접근할 필요가 생길 때 Pro Team($20/월)으로 전환한다. 코드 배포는 개인 계정으로도 공용 레포에서 충분히 운영 가능하다.

---

#### 0-A-4. Sentry 조직 프로젝트 생성

현재 Sentry `workdeck` 프로젝트를 제품 운영 계정으로 이전한다.

> **소유 계정**: `devops@workdeck.work` (에러 모니터링 = 제품 운영 도구)

**방법: 조직 계정에서 새 프로젝트 생성** (이력 불필요, 새 DSN 발급):

```
sentry.io → devops@workdeck.work 로그인
→ New Organization → "Workdeck" (또는 기존 조직 선택)
→ Projects → Create Project
→ Platform: Next.js 선택
→ Project name: workdeck
→ Create Project → DSN 복사
```

**발급 후 수집할 정보**:

```
DSN          → NEXT_PUBLIC_SENTRY_DSN
Org Slug     → SENTRY_ORG  (sentry.io/organizations/<slug>/ 에서 확인)
Auth Token   → SENTRY_AUTH_TOKEN
              (User Settings → Auth Tokens → Create New Token)
```

**기존 개인 Sentry 프로젝트 처리**:

```
새 조직 프로젝트 정상 동작 확인 후
→ 기존 개인 계정 workdeck 프로젝트 삭제 또는 비활성화
```

---

#### 0-A-5. 로컬 환경변수 전체 교체

```bash
# .env.local — workdeck-dev (Supabase) 기준
NEXT_PUBLIC_SUPABASE_URL=https://<workdeck-dev-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

DATABASE_URL=postgresql://postgres.<workdeck-dev-ref>:<PW>@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.<workdeck-dev-ref>:<PW>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres

NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=workdeck         # devops@workdeck.work 조직 slug
SENTRY_PROJECT=workdeck
SENTRY_AUTH_TOKEN=sntrys_...
```

---

#### 0-A-6. Prisma 스키마 재적용 및 동작 확인

```bash
npx prisma generate          # 클라이언트 재생성
npx prisma migrate dev       # 새 workdeck-dev DB에 스키마 적용
npm run build                # 빌드 오류 확인
npm run dev                  # 로컬 동작 확인
```

---

#### 0-A 검증 체크리스트

- [ ] GitHub `kaleos-platform/workdeck-app` 레포 접근 가능
- [ ] 로컬 `git remote -v` → `github.com/kaleos-platform/workdeck-app`
- [ ] `workdeck-dev` Supabase: `npx prisma migrate dev` 성공
- [ ] `workdeck-prod` Supabase: 프로젝트 생성 완료, 환경변수 수집 완료
- [ ] Vercel → kaleos-platform/workdeck-app 레포 재연결 확인
- [ ] Vercel Production/Preview 환경변수 각각 prod/dev Supabase로 설정
- [ ] Google OAuth redirect URI 각 Supabase 프로젝트에 등록 완료
- [ ] Sentry kaleos 조직 프로젝트 생성, 새 DSN 환경변수 반영
- [ ] `npm run build` 통과
- [ ] 로컬 `npm run dev` → 회원가입 → 대시보드 진입 정상

---

### Phase 0-B. 인프라 기반 세팅 (0.5~1일)

**목표**: 도메인, Vercel 환경변수 정리 (Phase 0-A 이후 진행)

#### 0-B-1. 도메인 연결 (`app.workdeck.work`)

Vercel Dashboard → Settings → Domains:

```
도메인 추가: app.workdeck.work
DNS: CNAME app → cname.vercel-dns.com
```

> Supabase 프로덕션 분리(workdeck-dev / workdeck-prod), Google OAuth 설정은 **Phase 0-A-2**에서 완료됨.

#### 0-B-2. Vercel 환경변수 최종 확인

Phase 0-A에서 설정한 환경변수가 올바르게 반영되었는지 확인:

```
Vercel → Settings → Environment Variables

Production  → NEXT_PUBLIC_SUPABASE_URL     (workdeck-prod)
            → NEXT_PUBLIC_SUPABASE_ANON_KEY (workdeck-prod)
            → DATABASE_URL                  (workdeck-prod pooler)
            → DIRECT_URL                    (workdeck-prod direct)
            → NEXT_PUBLIC_APP_URL           https://app.workdeck.work

Preview     → NEXT_PUBLIC_SUPABASE_URL     (workdeck-dev)
            → NEXT_PUBLIC_SUPABASE_ANON_KEY (workdeck-dev)
            → DATABASE_URL                  (workdeck-dev pooler)
            → DIRECT_URL                    (workdeck-dev direct)
```

#### 0-B 검증 체크리스트

- [ ] `https://app.workdeck.work` 접속 → 앱 정상 로드
- [ ] Google OAuth 로그인 → `/auth/callback` 정상 처리
- [ ] Vercel Production/Preview 환경변수 분리 확인
- [ ] Preview 배포 URL에서도 로그인 정상 동작 (workdeck-dev 연결 확인)

---

### Phase 1. 데이터 모델 확장 (3~5일)

**목표**: Space/SpaceMember/DeckApp/DeckInstance 추가 + 기존 데이터 백필

#### 1-1. `prisma/schema.prisma` 추가 모델

```prisma
enum SpaceType       { PERSONAL  ORGANIZATION }
enum PlanType        { FREE  STARTER  PRO  TEAM }
enum SpaceMemberRole { OWNER  ADMIN  MEMBER }

// 공간 (개인 or 조직 테넌트)
model Space {
  id   String    @id @default(cuid())
  name String
  type SpaceType @default(PERSONAL)

  members       SpaceMember[]
  deckInstances DeckInstance[]
  billingEvents BillingEvent[]
  meterEvents   MeterEvent[]

  // Stripe 과금 정보
  stripeCustomerId     String?  @unique
  stripeSubscriptionId String?  @unique
  currentPlan          PlanType @default(FREE)
  planExpiresAt        DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 공간 멤버십 + 역할
model SpaceMember {
  id      String          @id @default(cuid())
  spaceId String
  userId  String
  role    SpaceMemberRole @default(MEMBER)

  space Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@unique([spaceId, userId])
  @@index([userId])
}

// 카드 앱 카탈로그 (전역 정의)
model DeckApp {
  id          String  @id  // "coupang-ads", "osmu", "commerce-ops"
  name        String
  description String?
  isActive    Boolean @default(true)

  instances DeckInstance[]
}

// Space에서 활성화된 카드 인스턴스
model DeckInstance {
  id        String  @id @default(cuid())
  spaceId   String
  deckAppId String
  isActive  Boolean @default(true)

  space   Space   @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  deckApp DeckApp @relation(fields: [deckAppId], references: [id])

  createdAt DateTime @default(now())

  @@unique([spaceId, deckAppId])
  @@index([spaceId])
}

// Stripe 과금 이벤트 로그
model BillingEvent {
  id            String   @id @default(cuid())
  spaceId       String
  stripeEventId String   @unique
  eventType     String
  payload       Json
  processedAt   DateTime @default(now())

  space Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)
}

// 사용량 미터링 이벤트
model MeterEvent {
  id        String   @id @default(cuid())
  spaceId   String
  deckAppId String
  eventType String   // "report_generated", "upload_processed", "analysis_run"
  quantity  Int      @default(1)
  metadata  Json?
  createdAt DateTime @default(now())

  space Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)

  @@index([spaceId, deckAppId, createdAt])
}
```

`User` 모델에 관계 추가:

```prisma
model User {
  // ... 기존 필드 모두 유지
  spaceMemberships SpaceMember[]
}
```

**기존 Workspace 모델은 삭제하지 않고 유지** (점진 전환 기간 동안 병행).

#### 1-2. DeckApp 시드 데이터 (`prisma/seed.ts`)

```typescript
const deckApps = [
  { id: 'coupang-ads', name: '쿠팡 광고 자동화' },
  { id: 'osmu', name: 'OSMU 광고 제작', isActive: false },
  { id: 'commerce-ops', name: '이커머스 운영 자동화', isActive: false },
]
for (const app of deckApps) {
  await prisma.deckApp.upsert({ where: { id: app.id }, create: app, update: {} })
}
```

#### 1-3. 백필 마이그레이션 (`prisma/scripts/backfill-spaces.ts`)

```
기존 Workspace마다:
  1. Space(PERSONAL, name=Workspace.name) 생성
  2. SpaceMember(userId=Workspace.ownerId, role=OWNER) 생성
  3. DeckInstance(deckAppId='coupang-ads', isActive=true) 생성
```

#### 1-4. 마이그레이션 실행

```bash
npx prisma migrate dev --name add_space_deck_billing_models
npx tsx prisma/scripts/backfill-spaces.ts
npx prisma db seed
npm run build  # 타입 오류 확인
```

#### 1-5. 검증

- [ ] 기존 Workspace 수 = 생성된 Space 수 = 생성된 DeckInstance 수
- [ ] 기존 캠페인 대시보드 기능 회귀 없음

---

### Phase 2. Stripe 결제 연동 (5~7일)

**목표**: 구독 기반 결제 시스템 + Feature Gating

#### 2-1. 패키지 설치

```bash
npm install stripe @stripe/stripe-js
```

#### 2-2. Stripe Dashboard 설정 순서

1. **Products** 생성:
   ```
   쿠팡 광고 자동화 - Starter: ₩39,000/월 (trial 14일)
   쿠팡 광고 자동화 - Pro:     ₩99,000/월 (trial 14일)
   쿠팡 광고 자동화 - Team:   ₩199,000/월 (trial 14일)
   ```
2. **Stripe Tax** → Korea (KR) 10% VAT 활성화
3. **Customer Portal** → 활성화 (구독 변경/취소 허용)
4. **Webhooks** → Endpoint 추가:
   ```
   URL: https://app.workdeck.work/api/stripe/webhook
   이벤트:
     checkout.session.completed
     invoice.payment_succeeded
     invoice.payment_failed
     customer.subscription.updated
     customer.subscription.deleted
   ```

#### 2-3. 환경변수 추가

```bash
# .env.local 및 Vercel Production 환경변수
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_TEAM=price_...
NEXT_PUBLIC_APP_URL=https://app.workdeck.work
```

#### 2-4. API 라우트 구조

```
app/api/stripe/
├── checkout/route.ts   POST: Checkout 세션 생성 → URL 반환
├── webhook/route.ts    POST: 이벤트 수신 (서명 검증 필수!)
└── portal/route.ts     POST: Customer Portal 세션 생성 → URL 반환
```

**webhook 핵심 처리 로직**:

```
checkout.session.completed
  → space.stripeCustomerId, stripeSubscriptionId, currentPlan 업데이트
  → BillingEvent 기록

customer.subscription.updated
  → space.currentPlan 업데이트

customer.subscription.deleted
  → space.currentPlan = FREE
  → space.planExpiresAt = 현재 시점

invoice.payment_failed
  → 사용자 이메일 알림 (Supabase Auth 이메일 또는 Resend)
```

#### 2-5. Feature Gating (`src/lib/entitlement.ts`)

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

export function hasFeature(plan: PlanType, feature: string): boolean {
  const features = PLAN_FEATURES[plan]
  return features.includes('*') || features.includes(feature)
}
```

#### 2-6. 빌링 페이지 (`app/billing/page.tsx`)

- 현재 플랜 + 갱신일 표시
- 업그레이드 버튼 (Stripe Checkout 연동)
- 이번 달 사용량 현황 (업로드 횟수, 분석 횟수)
- Customer Portal 진입 버튼 ("구독 관리")

#### 2-7. 검증

- [ ] Stripe Test 카드로 결제 → `Space.currentPlan` 업데이트 확인
- [ ] Webhook 서명 검증 실패 시 400 반환
- [ ] 구독 취소 → FREE 다운그레이드 확인
- [ ] Customer Portal 접속 가능

---

### Phase 3. Core OS 레이어 전환 (5~7일)

**목표**: `resolveWorkspace()` → `resolveDeckContext()` 점진 전환 + RBAC

#### 3-1. `resolveDeckContext()` (`src/lib/api-helpers.ts`)

```typescript
export async function resolveDeckContext(deckKey: string = 'coupang-ads') {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  // 사용자의 Space 멤버십 조회 (첫 번째 Space)
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: {
      space: { select: { id: true, currentPlan: true, name: true } },
    },
  })
  if (!membership) return { error: errorResponse('공간이 없습니다', 404) }

  // DeckInstance 활성 여부 확인
  const deckInstance = await prisma.deckInstance.findUnique({
    where: {
      spaceId_deckAppId: { spaceId: membership.space.id, deckAppId: deckKey },
    },
  })
  if (!deckInstance?.isActive) {
    return { error: errorResponse('카드가 활성화되지 않았습니다', 403) }
  }

  return { user, space: membership.space, role: membership.role }
}
```

기존 `resolveWorkspace()`는 **래핑 방식**으로 호환성 유지:

```typescript
// 점진 전환 기간 동안 기존 코드 변경 없이 유지
export async function resolveWorkspace() {
  // 기존 Workspace 기반 로직 그대로 유지
}
```

#### 3-2. RBAC 가드 (`src/lib/api-helpers.ts`)

```typescript
const ROLE_HIERARCHY: Record<SpaceMemberRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
}

export function assertRole(
  userRole: SpaceMemberRole,
  requiredRole: SpaceMemberRole
): NextResponse | null {
  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[requiredRole]) {
    return errorResponse('권한이 없습니다', 403)
  }
  return null
}
```

#### 3-3. Same-space 검증 (`src/lib/api-helpers.ts`)

```typescript
export function assertSameSpace(sourceSpaceId: string, targetSpaceId: string): NextResponse | null {
  if (sourceSpaceId !== targetSpaceId) {
    // 보안 로그 기록 후 차단
    return errorResponse('cross-space 통신은 허용되지 않습니다', 403)
  }
  return null
}
```

#### 3-4. 사용량 미터링 (`src/lib/meter.ts`)

```typescript
type MeterEventType = 'report_generated' | 'upload_processed' | 'analysis_run'

export async function trackMeterEvent(
  spaceId: string,
  deckAppId: string,
  eventType: MeterEventType,
  quantity = 1
) {
  await prisma.meterEvent.create({
    data: { spaceId, deckAppId, eventType, quantity },
  })
}
```

업로드 API (`/api/reports/upload`) 완료 후 호출:

```typescript
await trackMeterEvent(space.id, 'coupang-ads', 'upload_processed')
```

#### 3-5. 검증

- [ ] `resolveDeckContext('coupang-ads')` → 기존 API 동일하게 동작
- [ ] OWNER만 가능한 액션에 MEMBER 접근 시 403
- [ ] 업로드 완료 → `MeterEvent` DB 레코드 생성 확인

---

### Phase 4. 앱 셸 UI 구현 (3~5일)

**목표**: My Deck 홈, Space 관리, Deck 진입 라우트

#### 4-1. 신규 라우트 추가

```
app/my-deck/
└── page.tsx          → 내 카드 목록 + 공간 선택

app/d/
└── [deckKey]/
    └── page.tsx      → 카드 진입 (coupang-ads → /dashboard redirect)

app/billing/
└── page.tsx          → 구독 관리

app/api/spaces/
└── route.ts          → GET: 내 Space 목록 + DeckInstance 목록
```

#### 4-2. Sidebar 업데이트 (`src/components/layout/sidebar.tsx`)

```
[My Deck 홈]         → /my-deck
[쿠팡 광고 관리]     → /dashboard (기존)
[빌링/구독 관리]     → /billing
[공간 설정]          → /space/[spaceId]
```

#### 4-3. 기존 대시보드 연결

`/d/coupang-ads` → 기존 `/dashboard` 로직 재사용 (redirect 또는 layout 공유).

#### 4-4. 검증

- [ ] `/my-deck` → 현재 활성 카드 목록 표시
- [ ] `/d/coupang-ads` → 캠페인 대시보드 정상 진입
- [ ] `/billing` → 플랜 정보 + Customer Portal 버튼

---

### Phase 5. RLS (Row Level Security) 설정 (1~2일)

**목표**: Supabase DB 레벨 보안 추가 (서버 격리 보완)

Supabase SQL Editor에서 실행:

```sql
-- 워크스페이스 기반 테이블 RLS 활성화
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyMemo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeywordStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignTarget" ENABLE ROW LEVEL SECURITY;

-- Space 기반 테이블 RLS 활성화
ALTER TABLE "Space" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MeterEvent" ENABLE ROW LEVEL SECURITY;

-- Workspace 소유자만 접근 허용 (예시)
CREATE POLICY "workspace_owner_only" ON "Workspace"
  FOR ALL USING ("ownerId" = auth.uid());

-- Space 멤버만 접근 허용 (예시)
CREATE POLICY "space_member_only" ON "Space"
  FOR ALL USING (
    id IN (
      SELECT "spaceId" FROM "SpaceMember"
      WHERE "userId" = auth.uid()
    )
  );
```

**참고**: Prisma는 `DATABASE_URL` (서비스 롤)로 연결하므로 RLS는 anon/user 키 직접 접근 방어 목적.

#### 검증

- [ ] Supabase Table Editor에서 RLS Enabled 표시 확인
- [ ] anon key로 직접 조회 시 빈 결과 반환 (RLS 격리 동작)
- [ ] 앱 정상 동작 (서비스 롤은 RLS 우회)

---

### Phase 6. 마케팅 사이트 분리 (별도 레포, 기간 미정)

**목표**: `workdeck.work` 홈페이지를 별도 Next.js 프로젝트로 분리

```bash
# 새 레포: workdeck-web
mkdir workdeck-web && cd workdeck-web
npx create-next-app@latest . --typescript --tailwind --app
```

**콘텐츠 구조**:

```
workdeck.work/
├── /                           → 메인 랜딩
├── /kr/cards/coupang-ads       → 쿠팡 광고 카드 랜딩 (KR)
├── /kr/cards/osmu              → OSMU 카드 랜딩 (KR)
├── /jp/cards/osmu              → OSMU 카드 랜딩 (JP)
└── /blog/[slug]                → 마케팅 블로그
```

**hreflang 설정**: 언어별 URL 분리 + `rel="alternate" hreflang="ko|ja|en"` 명시.

현재 `app/(marketing)/` 라우트는 임시 유지, 이후 별도 사이트로 이전.

---

## 6. 환경변수 전체 목록 (목표 상태)

```bash
# Supabase (환경별 분리)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=          # 풀링 URL (앱 런타임)
DIRECT_URL=            # 직접 연결 URL (마이그레이션)

# Stripe
STRIPE_SECRET_KEY=                      # sk_live_...
STRIPE_WEBHOOK_SECRET=                  # whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=     # pk_live_...
STRIPE_PRICE_STARTER=                   # price_... (₩39,000/월)
STRIPE_PRICE_PRO=                       # price_... (₩99,000/월)
STRIPE_PRICE_TEAM=                      # price_... (₩199,000/월)

# 앱
NEXT_PUBLIC_APP_URL=https://app.workdeck.work

# 모니터링 (기존 유지)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=workdeck
SENTRY_AUTH_TOKEN=

# 테스트 (개발 환경만)
TEST_LOGIN_EMAIL=
TEST_LOGIN_PASSWORD=
```

---

## 7. 기술 결정 사항 (구현 전 확인 필요)

| 항목                   | 옵션 A                    | 옵션 B                          | 권장                               |
| ---------------------- | ------------------------- | ------------------------------- | ---------------------------------- |
| 레포 이름              | `coupang-ad-manager` 유지 | `workdeck-app` 으로 rename      | **workdeck-app** (브랜드 일관성)   |
| GitHub 이전 방식       | Transfer (히스토리 보존)  | 새 레포 생성 후 push            | **Transfer** (kaleos 조직으로)     |
| Supabase 이전 방식     | 프로젝트 Transfer         | 새 프로젝트 생성 후 migrate     | **새 생성** (데이터 불필요)        |
| Vercel 이전 방식       | Pro Team 이전 ($20/월~)   | 개인 계정 유지 + 조직 레포 연결 | **개인 계정 유지** (1인 개발 단계) |
| Vercel 업그레이드 시점 | 즉시                      | 팀원 합류/공동 접근 필요 시     | **팀원 합류 시**                   |
| 레포 구조              | 단일 레포 유지            | workdeck-app 분리               | MVP: 단일 레포                     |
| Stripe 도입 시점       | Phase 1과 병행            | Phase 1 완료 후                 | Phase 1 완료 후                    |
| Stripe 과금 모델       | 단순 월정액               | 사용량 기반 과금                | MVP: 월정액 → 이후 사용량 추가     |
| 기존 사용자 전환       | 수동 안내                 | 자동 백필 스크립트              | 자동 백필                          |

---

## 8. 구현 순서 요약

```
Phase 0-A (0.5~1일) ← 신규: 조직 계정 이전
  GitHub 레포 Transfer → workdeck-app (조직)
  Supabase 새 프로젝트 생성 (workdeck-dev / workdeck-prod)
  Prisma migrate dev → 새 DB에 스키마 적용
  Vercel 프로젝트 이전 + GitHub 재연결
  Sentry 조직 계정 이전
  환경변수 전체 교체 + 앱 동작 확인
        ↓
Phase 0-B (0.5~1일)
  도메인 app.workdeck.work 연결
  Vercel Production/Preview 환경변수 최종 확인
        ↓
Phase 1 (3~5일)
  Space / SpaceMember / DeckApp / DeckInstance 모델 추가
  DeckApp 시드 (coupang-ads, osmu, commerce-ops)
  기존 Workspace → Space 백필 마이그레이션
        ↓
Phase 2 (5~7일)
  Stripe 상품/가격 설정 (Dashboard)
  Checkout / Webhook / Portal API 구현
  Feature Gating (entitlement.ts)
  빌링 페이지 UI
        ↓
Phase 3 (5~7일)
  resolveDeckContext() 구현
  RBAC assertRole() / assertSameSpace() 가드
  사용량 미터링 (MeterEvent)
        ↓
Phase 4 (3~5일)
  /my-deck, /d/[deckKey], /billing 라우트
  Sidebar 업데이트
        ↓
Phase 5 (1~2일)
  RLS Supabase 정책 설정
        ↓
Phase 6 (별도)
  workdeck.work 마케팅 사이트 (별도 레포)

총 예상: 19~30일 (약 4~6주)
※ Phase 0-A는 코드 작업이 아닌 서비스 이전 작업으로, 미리 완료 후 개발 진행 권장
```

---

## 9. 카드별 과금 플랜 (MVP 기준)

### 쿠팡 광고 자동화 (Coupang Ads Card)

| 플랜    | 월 요금  | 포함                       | 주요 제한                        |
| ------- | -------- | -------------------------- | -------------------------------- |
| FREE    | 0원      | 기본 대시보드              | 업로드 3회/월, 분석 기능 제한    |
| Starter | ₩39,000  | 1 워크스페이스 / 1 사용자  | 업로드 30회/월, 키워드·상품 분석 |
| Pro     | ₩99,000  | 1 워크스페이스 / 3 사용자  | 업로드 150회/월, 내보내기, 알림  |
| Team    | ₩199,000 | 1 워크스페이스 / 10 사용자 | 업로드 무제한, 전체 기능         |

MVP Phase 2에서는 **Starter/Pro 2개 플랜만** 구현 (Team은 Phase 3에서 추가).

---

## 10. 단계별 검증 체크리스트

### Phase 0-A 완료 조건 (조직 계정 이전)

- [ ] GitHub `kaleos-platform/workdeck-app` 레포 접근 가능 (Transfer 완료)
- [ ] 로컬 `git remote -v` → `github.com/kaleos-platform/workdeck-app`
- [ ] `workdeck-dev` Supabase (Kaleos 조직): `npx prisma migrate dev` 성공
- [ ] `workdeck-prod` Supabase (Kaleos 조직): 프로젝트 생성 + 환경변수 수집 완료
- [ ] Vercel: kaleos-platform/workdeck-app 레포 재연결 확인 (개인 계정 유지)
- [ ] Vercel: Production → workdeck-prod, Preview → workdeck-dev 환경변수 적용
- [ ] Google OAuth redirect URI: 각 Supabase 프로젝트에 등록
- [ ] Sentry: kaleos 조직 workdeck 프로젝트 생성 + 새 DSN 환경변수 반영
- [ ] `npm run build` 통과
- [ ] 로컬 `npm run dev` → 회원가입 → 대시보드 진입 정상

### Phase 0-B 완료 조건 (인프라 기반)

- [ ] `https://app.workdeck.work` 정상 접속
- [ ] Google OAuth → `/auth/callback` 정상 처리
- [ ] Vercel Production/Preview 환경변수 분리 확인

### Phase 1 완료 조건

- [ ] `npx prisma migrate dev` 성공
- [ ] 백필 후 Space 수 = 기존 Workspace 수
- [ ] 기존 coupang-ads 기능 회귀 없음 (`npm run build` 통과)

### Phase 2 완료 조건

- [ ] Stripe Test 카드 결제 → `Space.currentPlan` 업데이트
- [ ] Webhook 서명 검증 실패 시 400 응답
- [ ] 구독 취소 → `currentPlan = FREE`
- [ ] Customer Portal 접속 및 구독 변경 가능

### Phase 3 완료 조건

- [ ] `resolveDeckContext('coupang-ads')` → 기존 API 동일 동작
- [ ] MEMBER 역할로 ADMIN 전용 API 접근 시 403
- [ ] 업로드 완료 후 `MeterEvent` 레코드 생성

### Phase 4 완료 조건

- [ ] `/my-deck` → 활성 카드 목록 표시
- [ ] `/d/coupang-ads` → 캠페인 대시보드 정상 진입
- [ ] `/billing` → 플랜 정보 + Customer Portal 버튼

### Phase 5 완료 조건

- [ ] Supabase Table Editor에서 RLS Enabled 표시
- [ ] anon key 직접 조회 시 빈 결과 (RLS 격리)
- [ ] 앱 정상 동작 유지 (서비스 롤 우회)
