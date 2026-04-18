# Repository Guidelines

## Initialization (MUST)

작업 시작 시 `docs/rules/00-meta.md`를 먼저 열어 Rule Router 기준을 확인한다.

- 기본 로드: `docs/rules/01-core.md`
- 조건부 로드:
  - Next.js(App Router)/UI 구조/성능/라우팅/컴포넌트 관련이면: `docs/rules/02-architecture.md` 추가
  - Prisma/DB 스키마/마이그레이션 관련이면: `docs/rules/02-architecture.md` 추가
  - 의존성 업데이트/취약점/권한/민감정보/API 보안/검증이면: `docs/rules/03-security.md` 추가
- 불확실하면 추측으로 규칙을 적용하지 말고, 필요한 규칙 파일을 먼저 열어 확인하거나 질문한다.

규칙은 “필요한 것만” 로드한다. 전체 규칙을 매번 로드하지 않는다.

## Project Structure & Module Organization

This repository is a Next.js 16 + TypeScript app-router project.

- `app/`: route groups and page/layout entry points (`(auth)`, `(marketing)`, `dashboard`).
- `src/components/`: feature-level UI (`auth`, `layout`, `marketing`, `providers`).
- `components/ui/`: shared shadcn-style primitives (button, dialog, tabs, etc.).
- `src/lib/`: Supabase clients, validation schemas, and utilities.
- `src/hooks/`: reusable React hooks (auth/user state).
- `prisma/`: database schema and Prisma configuration.
- `public/`: static assets.

Prefer `@/` imports instead of deep relative paths.

## Build, Test, and Development Commands

- `npm run dev`: start local dev server at `http://localhost:3000`.
- `npm run build`: create a production build (also catches type/build issues).
- `npm run start`: run the production server from the built output.
- `npm run lint`: run ESLint with the Next.js config.

DB 스키마 변경 시 반드시 `npx prisma migrate dev --name <작업명>` 사용. `prisma db push` 및 prod DB 직접 SQL 실행 금지. (상세: `docs/rules/02-architecture.md` §4)

## Coding Style & Naming Conventions

- Language: TypeScript (`.ts`/`.tsx`) with `strict` mode enabled.
- Indentation: 2 spaces; keep semicolon and double-quote style consistent with existing files.
- Components: `PascalCase` file/function names (`LoginForm`).
- Hooks: `use-*` pattern and colocate in `src/hooks/` (`use-auth.ts`).
- Route folders: lowercase, grouped by feature (e.g., `app/(marketing)/pricing/page.tsx`).

Run `npm run lint` before opening a PR.

## Testing Guidelines

There is no committed automated test suite yet. For now:

- Validate changes with `npm run lint` and `npm run build`.
- Manually verify affected flows (auth, dashboard, marketing pages).
- When adding tests, place them near the feature (for example `src/components/auth/__tests__/login-form.test.tsx`) and use `*.test.ts(x)` naming.

## Commit & Pull Request Guidelines

Follow the existing commit style from history: optional emoji + Conventional Commit type.

- Examples: `🐛 fix: 푸터 링크 중복 key 오류 수정`, `📝 docs: CLAUDE.md 정리`.
- Common types: `feat`, `fix`, `docs`, `chore`, `security`.

PRs should include:

- clear summary and scope,
- linked issue/task (if available),
- screenshots or short video for UI changes,
- notes for env/schema changes (`.env.local`, `prisma/schema.prisma`).
