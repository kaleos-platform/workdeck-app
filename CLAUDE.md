# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 명령어

```bash
# Prisma
npx prisma generate          # Prisma 클라이언트 생성
npx prisma migrate dev       # 마이그레이션 생성 및 적용
npx prisma studio            # Prisma Studio (DB GUI)
```

## 아키텍처 개요

**Supabase Auth + Prisma + PostgreSQL** 구조의 SaaS 스타터킷.

### 인증 흐름

- `middleware.ts`: 세션 갱신, `/dashboard` 보호, `/login`·`/signup` 리다이렉트
- 서버 컴포넌트: `src/lib/supabase/server.ts`의 `createClient()` → `src/hooks/use-user.ts`의 `getUser()`
- 클라이언트 컴포넌트: `src/lib/supabase/client.ts`의 `createClient()` → `src/hooks/use-auth.ts`의 `useAuth()`

### 라우트 구조

- `app/(marketing)/` — 공개 마케팅 페이지
- `app/(auth)/` — 로그인/회원가입
- `app/dashboard/` — 인증 필요 영역 (`layout.tsx`에서 서버사이드 인증 확인)

### 데이터 모델 (`prisma/schema.prisma`)

- `User` ↔ `Organization` (다대일) ↔ `Subscription` ↔ `Plan`
- `Payment`: Stripe 및 Toss Payments 필드 병존
- `UsageMetric`: 조직별 사용량 추적

### 경로 별칭

- `@/components` → `src/components/` (shadcn/ui는 `src/components/ui/`)
- `@/lib` → `src/lib`
- `@/hooks` → `src/hooks`

### 기술 스택 특이사항

- **shadcn/ui**: new-york 스타일, lucide 아이콘
- **폼 검증**: react-hook-form + Zod (`src/lib/validations/`)
- **Tailwind CSS v4** (v3과 설정 방식 다름)

### 환경 변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
DATABASE_URL
```
