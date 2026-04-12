# CLAUDE.md

**워크덱**은 여러가지 비즈니스 업무를 선택해서 사용하므로서 비즈니스 목표를 달성하는 웹 서비스입니다.

@AGENTS.md

## Initialization (MUST)

규칙은 다음 순서로 적용한다:

- docs/rules/00-meta.md → docs/rules/01-core.md → (필요 시) 02-architecture.md / 03-security.md

토큰 절약을 위해, meta-rule이 지시하지 않으면 추가 규칙을 읽지 않는다.

상세 요구사항은 @/docs/prd.md 참조

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개발 명령어

```bash
# Prisma
npx prisma generate          # Prisma 클라이언트 생성
npx prisma migrate dev       # 마이그레이션 생성 및 적용
npx prisma studio            # Prisma Studio (DB GUI)
```

## 아키텍처 개요

**Supabase Auth + Prisma + PostgreSQL** 구조의 쿠팡 광고 분석 서비스.

### 인증 흐름

- `middleware.ts`: 세션 갱신, `/dashboard` · `/workspace-setup` 보호, 미인증 시 `/login` 리다이렉트
- 회원가입 → 워크스페이스 미생성 시 `/workspace-setup` 리다이렉트 (dashboard layout에서 처리)
- 서버 컴포넌트: `src/lib/supabase/server.ts`의 `createClient()` → `src/hooks/use-user.ts`의 `getUser()`
- 클라이언트 컴포넌트: `src/lib/supabase/client.ts`의 `createClient()` → `src/hooks/use-auth.ts`의 `useAuth()`

### 라우트 구조

- `app/(marketing)/` — 공개 랜딩 페이지
- `app/(auth)/login/` — 로그인
- `app/(auth)/signup/` — 회원가입
- `app/(auth)/workspace-setup/` — 워크스페이스 설정 (최초 1회)
- `app/dashboard/` — 전체 워크스페이스 요약 대시보드
- `app/dashboard/upload/` — Excel 리포트 업로드 (F001)
- `app/dashboard/campaigns/[campaignId]/` — 캠페인 상세 (대시보드·광고 데이터·키워드 분석 탭)

### 데이터 모델 (`prisma/schema.prisma`)

- `User` ↔ `Workspace` (일대일, User가 소유)
- `Workspace` → `ReportUpload` (업로드 이력)
- `Workspace` → `AdRecord` (광고 데이터 행)
- `Workspace` → `DailyMemo` (일자별 메모, campaignId + date 복합 unique)

### 경로 별칭

- `@/components` → `src/components/` (shadcn/ui는 `src/components/ui/`)
- `@/lib` → `src/lib`
- `@/hooks` → `src/hooks`

### 기술 스택 특이사항

- **shadcn/ui**: new-york 스타일, lucide 아이콘
- **폼 검증**: react-hook-form + Zod (`src/lib/validations/`)
- **Tailwind CSS v4** (v3과 설정 방식 다름)
- **Prisma 7**: datasource url은 `prisma.config.ts`에서 관리 (schema.prisma에 url 없음)
- **xlsx (SheetJS)**: Excel .xlsx 파일 파싱용 (별도 설치 필요: `npm install xlsx`)

### 환경 변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
DATABASE_URL
```
