# Project Context: coupang-ad-manager

This project is a comprehensive SaaS starter kit designed for building scalable web applications with Next.js, Supabase, and Prisma.

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
