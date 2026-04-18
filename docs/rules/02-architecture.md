# Architecture Rules

- scope: nextjs,supabase,ui
- priority: 90
- strength: MUST

## 1. Next.js (App Router)

- 기본: Server Component.
- "use client"는 상태/브라우저 API 필요 시에만 사용.
- 데이터 패칭은 서버에서 async/await 사용.
- App Router 규약(page/layout/loading/error/route.ts) 준수.

## 2. Supabase

- Next.js 연동 시 @supabase/ssr 사용.
- DB 타입은 생성된 TS 타입 적용.
- 민감 데이터/권한 우회 로직은 서버에서만 처리.
- RLS 적용 전제하에 설계.

## 3. UI & State

- Tailwind CSS 사용.
- 비즈니스 로직은 UI와 분리.
- 복잡 로직은 custom hook 또는 별도 모듈로 분리.

## 4. Prisma & DB Migration

- Dev/Prod DB 는 별도 Supabase 프로젝트로 분리되어 있으며, 데이터는 절대 서로 옮겨지지 않는다. 스키마 동기화는 마이그레이션 파일로만 이뤄진다.
- 스키마 변경 시 반드시 `npx prisma migrate dev --name <작업명>` 사용 → `prisma/migrations/<timestamp>_<name>/migration.sql` 생성 + dev DB 자동 적용.
- 마이그레이션 파일은 **반드시 git에 커밋**한다. 파일 없이 스키마만 변경하면 prod 동기화가 깨진다.
- **금지**: `prisma db push` (개발/프로덕션 모두). 마이그레이션 이력이 기록되지 않아 배포 시 prod 스키마가 뒤처진다.
- **금지**: 프로덕션 DB에 직접 SQL/ALTER 실행. `_prisma_migrations` 테이블과 실제 스키마가 어긋나 이후 배포가 실패한다.
- 배포는 `vercel.json` 의 `buildCommand` 에 포함된 `npx prisma migrate deploy` 가 자동 수행한다. 수동 개입 불필요.
- 예외적으로 스키마 drift 를 복구해야 할 경우 `prisma migrate resolve --applied <migration>` 로 기록만 맞춘 뒤, 다음 변경부터 정상 워크플로로 복귀한다.
