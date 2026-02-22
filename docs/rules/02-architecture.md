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
