# Project Context: coupang-ad-manager

This project is a comprehensive SaaS starter kit designed for building scalable web applications with Next.js, Supabase, and Prisma.

## Initialization (MUST)

### 1. Rule Loading Policy (Token Optimized)

규칙 로딩은 다음 우선순위와 조건을 따른다:

- **기본 로드:** `docs/rules/00-meta.md`, `docs/rules/01-core.md`
- **조건부 로드:**
  - Next.js(App Router)/UI 구조/성능/라우팅/컴포넌트 관련: `+ docs/rules/02-architecture.md`
  - 의존성 업데이트/취약점/권한/민감정보/API 보안/검증: `+ docs/rules/03-security.md`

추가 규칙이 필요한지 불확실하면 추측하지 말고 규칙 파일을 확인하거나 질문한다. 항상 전체 규칙을 로드하지 않는다(토큰 최적화).

### 2. Response Format

- 불필요한 서론/인사 없이 본론부터 응답한다.
- 구현 전 **3–7개 불릿 계획** 제시 → 구현 → 간단 검증 순서로 진행한다.

## Project Overview

- **Purpose:** SaaS starter kit featuring multi-tenancy, authentication, and subscription management.
- **Architecture:** Next.js App Router with a split between `app/` (routing) and `src/` (business logic).
- **Core Stack:**
  - **Framework:** Next.js 16 (App Router)
  - **Authentication:** Supabase Auth (`@supabase/ssr`)
  - **ORM:** Prisma with PostgreSQL
  - **Styling:** Tailwind CSS v4 + Shadcn UI
  - **State Management:** Zustand
  - **Validation:** Zod + React Hook Form
  - **Icons:** Lucide React

## Getting Started

### Prerequisites

- Node.js & npm
- PostgreSQL database
- Supabase project

### Development Commands

```bash
# Install dependencies
npm install

# Database setup
npx prisma generate
npx prisma migrate dev
npx prisma studio # Open DB GUI

# Run development server
npm run dev

# Build and lint
npm run build
npm run lint
```

### Environment Variables

Required in `.env`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL` (PostgreSQL connection string)

## Project Structure & Conventions

### Directory Layout

- `app/`: Routes and Page components.
  - `(marketing)/`: Public landing pages.
  - `(auth)/`: Login and Signup pages.
  - `dashboard/`: Authenticated user area.
- `src/`: Core application logic.
  - `components/`: Functional components (Auth, Marketing, Layout, etc.).
  - `hooks/`: Custom React hooks (e.g., `use-auth.ts`, `use-user.ts`).
  - `lib/`: Shared utilities, Supabase client/server/middleware logic, and Zod schemas.
- `components/ui/` & `src/components/ui/`: Reusable UI primitives (Shadcn UI).
- `prisma/`: Database schema (`schema.prisma`) and migrations.

### Key Conventions

- **Path Aliases:** `@/` is mapped to `./src/*` first, then `./*`.
- **Authentication:**
  - Server-side client: `src/lib/supabase/server.ts`
  - Client-side client: `src/lib/supabase/client.ts`
  - Auth Middleware: `middleware.ts` handles session persistence and route protection.
- **Database:** Prisma is the primary interface for database operations, while Supabase handles Auth and storage.
- **Styling:** Uses Tailwind CSS v4. Note that configuration and syntax may differ slightly from v3.

## Data Model (Prisma)

- `User`: Core user identity.
- `Organization`: Multi-tenant entity; users belong to organizations.
- `Plan` & `Subscription`: Handles SaaS billing levels.
- `Payment`: Tracking for Stripe and Toss Payments.
- `UsageMetric`: Business metrics tracking for organizations.
