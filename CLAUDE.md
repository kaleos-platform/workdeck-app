# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 명령어

```bash
npm run dev      # 개발 서버 실행 (localhost:3000)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint 실행
```

### Prisma

```bash
npx prisma generate          # Prisma 클라이언트 생성
npx prisma migrate dev       # 마이그레이션 생성 및 적용
npx prisma studio            # Prisma Studio (DB GUI)
```

### shadcn/ui 컴포넌트 추가

```bash
npx shadcn@latest add <component>
```

## 아키텍처 개요

**Supabase Auth + Prisma + PostgreSQL** 구조의 SaaS 스타터킷입니다.

### 인증 흐름

- Supabase Auth가 인증 담당 (`@supabase/ssr` 사용)
- `middleware.ts`: 모든 요청에서 세션 갱신, `/dashboard` 보호, `/login`·`/signup` 리다이렉트 처리
- 서버 컴포넌트: `src/lib/supabase/server.ts`의 `createClient()` → `src/hooks/use-user.ts`의 `getUser()` 사용
- 클라이언트 컴포넌트: `src/lib/supabase/client.ts`의 `createClient()` → `src/hooks/use-auth.ts`의 `useAuth()` 사용

### 라우트 구조

- `app/(marketing)/` — 공개 마케팅 페이지 (랜딩, 가격, 문의)
- `app/(auth)/` — 로그인/회원가입 페이지
- `app/dashboard/` — 인증 필요한 대시보드 영역
  - `layout.tsx`에서 서버사이드로 사용자 확인 후 미인증 시 리다이렉트

### 데이터 모델 (prisma/schema.prisma)

- `User` ↔ `Organization` (다대일) ↔ `Subscription` ↔ `Plan`
- `Payment`: Stripe 및 Toss Payments 필드 병존
- `UsageMetric`: 조직별 사용량 추적

### 경로 별칭 (`tsconfig.json` 기준)

- `@/components` → `src/components` 또는 루트 `components/`
- `@/lib` → `src/lib`
- `@/hooks` → `src/hooks`

> shadcn/ui 컴포넌트는 루트 `components/ui/`에, 커스텀 컴포넌트는 `src/components/`에 위치합니다.

### 주요 기술 스택

- **Next.js 16** (App Router, RSC)
- **Supabase** — Auth 및 세션 관리
- **Prisma 7** — DB ORM (PostgreSQL)
- **Tailwind CSS v4**
- **shadcn/ui** (new-york 스타일, lucide 아이콘)
- **Zustand** — 클라이언트 상태 관리
- **react-hook-form + Zod** — 폼 유효성 검사 (`src/lib/validations/`)
- **Recharts** — 차트
- **sonner** — 토스트 알림

### 환경 변수

```
NEXT_PUBLIC_SUPABASE_URL: https://ypnawimqcjabzuzupzwj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY: sb_publishable_QYx68elxzQqNerwTgSb8nw_V7q7SziT
DATABASE_URL
```
