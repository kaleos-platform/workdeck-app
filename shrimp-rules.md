# Shrimp Rules — 쿠팡 광고 리포트 매니저 AI Agent 개발 표준

> AI Agent 전용 개발 표준 문서.
> 코드 생성·수정 시 이 규칙을 우선 적용한다.

---

## 1. 프로젝트 개요

**목적**: 쿠팡 광고 리포트 Excel/CSV를 업로드·분석해 비효율 광고비를 절감하고 ROAS를 개선하는 웹 서비스.

**기술 스택**

| 레이어     | 기술                                          |
| ---------- | --------------------------------------------- |
| 프레임워크 | Next.js 16 (App Router) + React 19            |
| 언어       | TypeScript (strict mode)                      |
| DB         | PostgreSQL via Supabase                       |
| ORM        | Prisma 7 (PrismaPg 어댑터)                    |
| 인증       | Supabase Auth (이메일 + 구글 OAuth)           |
| UI         | shadcn/ui (new-york 스타일) + Tailwind CSS v4 |
| 아이콘     | lucide-react                                  |
| 폼         | react-hook-form + Zod                         |
| 파일 파싱  | xlsx (SheetJS)                                |
| 알림       | sonner                                        |

**상세 요구사항 참조**: `docs/prd.md`, `docs/ROADMAP.md`

---

## 2. 디렉토리 구조

```
app/
  (auth)/login/               # 로그인 페이지
  (auth)/signup/              # 회원가입 페이지
  (auth)/workspace-setup/     # 최초 워크스페이스 설정 (1회)
  (marketing)/                # 공개 랜딩 페이지
  api/
    campaigns/[campaignId]/metrics/              # 날짜별 시계열 지표
    campaigns/[campaignId]/records/              # 광고 데이터 목록 (페이지네이션·정렬)
    campaigns/[campaignId]/memos/                # 일자별 메모 CRUD
    campaigns/[campaignId]/inefficient-keywords/ # 비효율 키워드 집계
    campaigns/                                   # 캠페인 목록
    reports/upload/                              # Excel/CSV 업로드
    workspace/                                   # 워크스페이스 CRUD
  dashboard/                  # 전체 요약 대시보드
  dashboard/upload/           # 업로드 페이지
  dashboard/campaigns/[campaignId]/ # 캠페인 상세 (대시보드·광고데이터·키워드 탭)
  auth/callback/              # 구글 OAuth 콜백 처리
proxy.ts                      # Next.js 16 미들웨어 (미인증 라우트 보호)

src/
  components/
    auth/         # 로그인·회원가입 폼 컴포넌트
    dashboard/    # 대시보드 UI (FilterBar, CampaignChart, DailyMemo)
    layout/       # Header, Sidebar
    marketing/    # 랜딩 페이지 헤더·푸터
    providers/    # ThemeProvider 등
    ui/           # shadcn/ui 기본 컴포넌트 (직접 수정 금지)
  hooks/
    use-auth.ts   # 클라이언트 컴포넌트용 인증 훅 (signOut 포함)
    use-user.ts   # 서버사이드 사용자 조회 함수
  lib/
    api-helpers.ts              # resolveWorkspace, errorResponse
    excel-parser.ts             # Excel/CSV 파싱 (parseExcelBuffer, parseCsvBuffer)
    prisma.ts                   # Prisma 클라이언트 Proxy 지연 초기화
    supabase/client.ts          # 클라이언트 컴포넌트용 Supabase 클라이언트
    supabase/server.ts          # 서버 컴포넌트용 Supabase 클라이언트
    supabase/middleware.ts      # 세션 갱신 유틸 (proxy.ts에서 호출)
    validations/auth.ts         # Zod 스키마 (로그인·회원가입)
  types/
    index.ts      # 프론트엔드 공유 타입 단일 소스

prisma/
  schema.prisma   # 데이터 모델 정의
```

### 경로 별칭

- `@/components` → `src/components/`
- `@/lib` → `src/lib/`
- `@/hooks` → `src/hooks/`
- `@/types` → `src/types/`

---

## 3. API 라우트 작성 규칙

### 3-1. params는 반드시 Promise로 받아야 한다 (Next.js 16)

```typescript
// CORRECT — Next.js 16 App Router
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
}

// WRONG — Next.js 15 이하 방식, 절대 사용 금지
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } } // await 없이 구조분해
) { ... }
```

### 3-2. 인증·워크스페이스 검증은 반드시 resolveWorkspace 사용

모든 인증이 필요한 API 라우트 첫 줄에 호출한다:

```typescript
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

const resolved = await resolveWorkspace()
if ('error' in resolved) return resolved.error
const { workspace } = resolved
```

- `resolveWorkspace()`는 Supabase 세션 → User → Workspace 순서로 검증한다.
- 401(미인증), 404(워크스페이스 없음) 응답을 자동으로 반환한다.
- 개별 라우트에서 중복 인증 로직 작성 금지.

### 3-3. 에러 응답은 errorResponse 사용

```typescript
return errorResponse('유효하지 않은 요청입니다', 400)
// 내부 구현: NextResponse.json({ message }, { status })
```

### 3-4. 날짜 필터 조건 구성 패턴

```typescript
// Asia/Seoul 기준 날짜 범위 필터
const dateFilter: { gte?: Date; lte?: Date } = {}
if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

// Prisma where 조건에 스프레드
const where = {
  workspaceId: workspace.id,
  campaignId,
  ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
  ...(adType && adType !== 'all' && { adType }),
}
```

### 3-5. 전체 API 라우트 보일러플레이트

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl

  // ... 비즈니스 로직

  return NextResponse.json({ ... })
}
```

---

## 4. Prisma 7 사용 규칙

### 4-1. import 경로

```typescript
// CORRECT
import { prisma } from '@/lib/prisma'
import { PrismaClient } from '@/generated/prisma/client'

// WRONG — 절대 사용 금지
import { PrismaClient } from '@prisma/client'
```

### 4-2. Decimal → Number 변환 (API 응답 직렬화 필수)

Prisma의 `Decimal` 타입은 JSON 직렬화 불가. API 응답 전 반드시 `Number()` 변환:

```typescript
// Decimal 컬럼: adCost, ctr, revenue1d, roas1d, revenue14d, roas14d
const normalized = items.map((r) => ({
  ...r,
  date: (r.date as Date).toISOString().split('T')[0],
  adCost: Number(r.adCost),
  ctr: Number(r.ctr),
  revenue1d: Number(r.revenue1d),
  roas1d: Number(r.roas1d),
  revenue14d: Number(r.revenue14d),
  roas14d: Number(r.roas14d),
}))
```

### 4-3. groupBy 결과 명시적 타입 선언

Prisma 7 생성 파일이 `@ts-nocheck`이므로 `groupBy` 결과가 `any`로 추론된다.
map 콜백에 반드시 명시적 타입 선언:

```typescript
const items = groups.map(
  (g: {
    keyword: string | null
    _sum: { adCost: unknown; impressions: unknown; clicks: unknown }
  }) => ({
    keyword: g.keyword!,
    adCost: Number(g._sum.adCost ?? 0),
    impressions: Number(g._sum.impressions ?? 0),
    clicks: Number(g._sum.clicks ?? 0),
  })
)
```

### 4-4. Nullable 필드 처리

`keyword`, `adGroup`, `optionId`, `placement`, `productName`은 `String?` (nullable).
`groupBy` where 조건에서 null 필터 가능: `keyword: { not: null }`

### 4-5. 데이터베이스 설정

- `prisma/schema.prisma`의 datasource 블록에는 `provider`만 명시 (url 없음)
- DB URL은 `prisma.config.ts`에서 관리

### 4-6. prisma.ts 수정 금지

`src/lib/prisma.ts`의 Proxy 지연 초기화 패턴은 Next.js 빌드 타임에 DB 미연결을 보장한다. 직접 수정 금지.

### 4-7. 스키마 변경 시 필수 명령

```bash
npx prisma generate   # 클라이언트 재생성 (스키마 변경 후 항상 실행)
npx prisma migrate dev  # 마이그레이션 생성 및 적용
```

---

## 5. 타입 관리 규칙

### 5-1. 프론트엔드 공유 타입 단일 소스

모든 프론트엔드 공유 타입은 `src/types/index.ts`에만 정의한다.
다른 파일에 공유 타입 정의 금지.

현재 정의된 타입:

- `Campaign` — 캠페인 기본 정보
- `AdRecord` — 광고 데이터 행
- `InefficientKeyword` — 비효율 키워드 항목
- `DailyMemo` — 일자별 메모
- `KpiSummary` — 워크스페이스 전체 KPI 요약
- `MetricSeries` — 날짜별 시계열 지표 데이터 포인트
- `UploadHistory` — 업로드 이력

새 공유 타입은 `src/types/index.ts`에 추가 후 import:

```typescript
import type { AdRecord, Campaign, KpiSummary } from '@/types'
```

### 5-2. 로컬 타입

단일 컴포넌트/파일에서만 사용하는 `interface`·`type`은 해당 파일 상단에 정의해도 된다.

### 5-3. API 응답 타입

API 라우트의 응답 구조가 프론트엔드 타입과 다른 경우, 프론트엔드 타입을 기준으로 맞춘다.

---

## 6. 인증 규칙

### 6-1. 서버 컴포넌트 / API 라우트

```typescript
// 서버사이드 유저 조회
import { getUser } from '@/hooks/use-user'
const user = await getUser()

// Supabase 클라이언트 (서버)
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()
```

### 6-2. 클라이언트 컴포넌트

```typescript
'use client'

// 클라이언트 인증 훅 (signOut, 인증 상태 구독 포함)
import { useAuth } from '@/hooks/use-auth'
const { user, isLoading, signOut } = useAuth()

// Supabase 클라이언트 (클라이언트)
import { createClient } from '@/lib/supabase/client'
```

### 6-3. 미들웨어 (proxy.ts)

- 파일: `proxy.ts` (프로젝트 루트) — Next.js 16에서 `middleware.ts` 대신 사용
- 함수명: `export async function proxy(request: NextRequest)`
- 보호 라우트: `/dashboard`, `/workspace-setup`
- 미인증 시 `/login`으로 리다이렉트

### 6-4. 금지 사항

- 서버 컴포넌트에서 `useAuth()` 호출 금지
- 클라이언트 컴포넌트에서 `src/lib/supabase/server.ts` import 금지
- `proxy.ts`에서 Prisma 직접 호출 금지 (워크스페이스 확인은 `app/dashboard/layout.tsx`에서 처리)

---

## 7. 날짜/시간 규칙

### 7-1. 표준 시간대: Asia/Seoul (UTC+9)

모든 날짜 입력·필터·저장은 Asia/Seoul 기준:

```typescript
// Excel 파싱 시 (parseKorDate in excel-parser.ts)
return new Date(`${year}-${month}-${day}T00:00:00+09:00`)

// API 날짜 필터 시
dateFilter.gte = new Date(from + 'T00:00:00+09:00')
dateFilter.lte = new Date(to + 'T23:59:59+09:00')
```

### 7-2. API 응답 날짜 포맷

날짜는 `YYYY-MM-DD` 문자열로 반환 (ISO 8601):

```typescript
date: (r.date as Date).toISOString().split('T')[0]
// 결과: "2026-02-07"
```

### 7-3. 쿠팡 리포트 날짜 형식

쿠팡 리포트의 날짜 컬럼은 `"20260207"` (8자리 숫자 문자열).
`parseKorDate()` 함수(`src/lib/excel-parser.ts`)가 자동 처리. 별도 구현 금지.

---

## 8. 필터 상태 관리 규칙

### 8-1. URL searchParams가 유일한 필터 상태 소스

날짜 범위·광고유형 필터는 URL searchParams에만 보관한다.
`useState`로 필터 상태를 별도 관리하지 않는다.

```typescript
// FilterBar 패턴 (src/components/dashboard/filter-bar.tsx)
const searchParams = useSearchParams()
const from = searchParams.get('from') ?? ''
const to = searchParams.get('to') ?? ''
const adType = searchParams.get('adType') ?? 'all'

// 변경 시 router.push로 URL 갱신
router.push(`${pathname}?${buildParams({ from: value })}`)
```

### 8-2. 필터 파라미터 규칙

| 파라미터    | 타입   | 예시          | 비고                                                          |
| ----------- | ------ | ------------- | ------------------------------------------------------------- |
| `from`      | string | `2026-01-01`  | YYYY-MM-DD, 없으면 전체 기간 시작                             |
| `to`        | string | `2026-01-31`  | YYYY-MM-DD, 없으면 전체 기간 끝                               |
| `adType`    | string | `키워드 광고` | `all` 또는 빈 값이면 전체                                     |
| `page`      | number | `1`           | 기본값 1                                                      |
| `pageSize`  | number | `25`          | 기본값 25, 최대 100                                           |
| `sortBy`    | string | `adCost`      | 허용 값: `date`, `adCost`, `clicks`, `impressions`, `roas14d` |
| `sortOrder` | string | `desc`        | `asc` 또는 `desc`                                             |

### 8-3. 필터 초기화

```typescript
router.push(pathname) // searchParams 없이 이동
```

---

## 9. 계산 지표 규칙

### 9-1. ROAS 지표

- `roas14d`: 14일 광고수익률 — **주요 지표** (퍼센트 값, 예: 350.25)
- `roas1d`: 1일 광고수익률 — 보조 지표
- DB에 저장된 값을 그대로 사용. 프론트엔드에서 재계산 금지.

### 9-2. 비효율 키워드 판단 기준

```
orders1d = 0 AND adCost > 0 (광고비 지출 + 주문 없음)
```

`/api/campaigns/[campaignId]/inefficient-keywords` 라우트가 집계를 담당한다.
프론트엔드에서 필터링 로직 중복 구현 금지.

### 9-3. KPI 집계

전체 워크스페이스 KPI(`totalAdCost`, `avgRoas14d`, `totalClicks`, `totalImpressions`)는
서버사이드에서 집계하여 API 응답으로 반환한다.
클라이언트에서 집계 로직 구현 금지.

### 9-4. 퍼센트 표시

ROAS, CTR은 퍼센트 단위로 DB에 저장됨 (예: CTR 1.5% → `1.5` 저장).
표시 시 `%` 단위 직접 추가: `${roas14d.toFixed(2)}%`

---

## 10. 컴포넌트 규칙

### 10-1. shadcn/ui 우선 사용

UI 컴포넌트는 `src/components/ui/`의 shadcn/ui 컴포넌트를 우선 사용한다.
`src/components/ui/` 파일들은 직접 수정하지 않는다.

```typescript
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
```

### 10-2. Tailwind CSS v4

- `tailwind.config.js` 파일 없음 — v4는 `app/globals.css`에서 직접 설정
- `@theme` 블록으로 커스텀 토큰 정의
- CSS 변수(`--background`, `--foreground`, `--primary` 등) 사용
- `@apply` 사용 최소화

### 10-3. 클라이언트 컴포넌트 선언

인터랙티브 컴포넌트는 파일 최상단에 `'use client'`:

```typescript
'use client'

import { useState } from 'react'
```

### 10-4. 서버 컴포넌트 기본

`'use client'` 없이 작성하면 서버 컴포넌트.
`useState`, `useEffect`, 이벤트 핸들러가 필요한 경우에만 클라이언트로 전환.

### 10-5. 아이콘

`lucide-react`에서만 import. 다른 아이콘 라이브러리 추가 금지:

```typescript
import { RotateCcw, Upload, TrendingUp, AlertCircle } from 'lucide-react'
```

### 10-6. 알림 (토스트)

`sonner` 사용:

```typescript
import { toast } from 'sonner'
toast.success('저장되었습니다')
toast.error('오류가 발생했습니다')
```

---

## 11. 다중 파일 동시 수정 규칙

아래 연동 관계를 항상 확인한다:

| 수정 대상                                | 함께 확인·수정할 파일                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `prisma/schema.prisma` 모델 추가/변경    | `src/types/index.ts`, 관련 API 라우트, `npx prisma generate` 실행 |
| `src/types/index.ts` 타입 변경           | 해당 타입을 import하는 모든 컴포넌트·API 라우트                   |
| `src/lib/api-helpers.ts` 변경            | 모든 API 라우트 (resolveWorkspace 시그니처 변경 시)               |
| API 라우트 응답 구조 변경                | 해당 API를 호출하는 클라이언트 컴포넌트·페이지                    |
| `src/lib/excel-parser.ts` 컬럼 매핑 변경 | 업로드 API (`app/api/reports/upload/route.ts`)                    |
| 필터 파라미터 추가/변경                  | `FilterBar` 컴포넌트, 관련 API 라우트, 호출 컴포넌트              |
| 새 shadcn/ui 컴포넌트 추가               | `npx shadcn add [component]` 실행 후 `src/components/ui/`에 배치  |
| 환경 변수 추가                           | `.env.local`, `CLAUDE.md`의 환경 변수 섹션 업데이트               |

---

## 12. 금지 사항

### 12-1. Prisma 관련

- `@prisma/client`에서 import — Prisma 7은 `@/generated/prisma/client`에서 import
- `prisma/schema.prisma` datasource에 url 직접 작성 (`prisma.config.ts` 사용)
- `src/lib/prisma.ts` Proxy 초기화 패턴 수정
- Decimal 타입을 `Number()` 변환 없이 JSON 응답에 포함

### 12-2. Next.js 관련

- `params`를 `await` 없이 사용 (Next.js 16에서 params는 Promise)
- `middleware.ts` 파일 생성 (Next.js 16 미들웨어는 `proxy.ts` 사용)
- `tailwind.config.js` 파일 생성 (v4는 CSS 기반 설정)

### 12-3. 인증 관련

- 서버 컴포넌트에서 `useAuth()`, `useState()`, `useEffect()` 호출
- 클라이언트 컴포넌트에서 `src/lib/supabase/server.ts` import
- `proxy.ts`에서 Prisma 직접 호출
- API 라우트에서 `resolveWorkspace` 없이 직접 인증 로직 구현

### 12-4. 타입 관련

- `any` 타입 사용 (명시적 타입 선언 필수)
- `src/types/index.ts` 외 위치에 공유 타입 정의

### 12-5. 상태·UI 관련

- `useState`로 필터 상태 관리 (URL searchParams 사용)
- 프론트엔드에서 ROAS·KPI 재집계 로직 구현
- `lucide-react` 외 다른 아이콘 라이브러리 추가
- `src/components/ui/` 파일 직접 수정

### 12-6. 날짜 관련

- UTC 그대로 날짜 처리 (Asia/Seoul 기준 변환 필수)
- 날짜 파싱 로직 중복 구현 (`excel-parser.ts` 함수 사용)

### 12-7. 보안

- `.env.local` 파일 git 커밋
- API 라우트에서 workspaceId 소유권 검증 누락
- `console.log` 프로덕션 코드에 남기기

---

_마지막 업데이트: 2026-02-22_
