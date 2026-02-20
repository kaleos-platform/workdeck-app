# Repository Guidelines

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

If you change DB models, also run Prisma workflows locally (for example: `npx prisma generate`).

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
