# 쿠팡 광고 리포트 매니저 - AI 개발 가이드라인

## 1. 프로젝트 개요

- **목적**: 쿠팡 광고 리포트 Excel 업로드·분석으로 ROAS 개선 및 광고비 절감
- **스택**: Next.js 16.1.6 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **인증**: Supabase Auth + @supabase/ssr
- **DB**: PostgreSQL + Prisma 7
- **상세 요구사항 참조**: `docs/PRD.md`, `docs/ROADMAP.md`

---

## 2. 디렉토리 구조 및 파일 배치 규칙

### 경로 별칭 (`@/*`)

- `tsconfig.json`에서 `@/*`는 `./src/*` AND `./`를 **모두** 포함
- `@/components` → `src/components/` 또는 `components/` 둘 다 해당됨
- **shadcn/ui 컴포넌트**: `src/components/ui/`에 배치 (추가 시 이 위치 사용)
  - 루트 `components/ui/`는 초기 설치 잔재 — 신규 컴포넌트는 `src/components/ui/`에 추가

### 앱 라우트 (`app/`)

```
app/(marketing)/          # 공개 랜딩 페이지 (인증 불필요)
app/(auth)/login/         # 로그인
app/(auth)/signup/        # 회원가입
app/(auth)/workspace-setup/ # 최초 워크스페이스 설정 (1회)
app/dashboard/            # 보호된 라우트 (로그인 필수)
app/dashboard/upload/     # Excel 리포트 업로드
app/dashboard/campaigns/[campaignId]/ # 캠페인 상세
```

### 소스 코드 (`src/`)

```
src/components/auth/      # 인증 관련 폼 컴포넌트
src/components/layout/    # Header, Sidebar 레이아웃 컴포넌트
src/components/marketing/ # 마케팅 페이지 전용 컴포넌트
src/components/ui/        # shadcn/ui 컴포넌트
src/components/providers/ # Context Provider 컴포넌트
src/hooks/use-auth.ts     # 클라이언트 컴포넌트용 인증 훅
src/hooks/use-user.ts     # 서버 컴포넌트용 사용자 조회 함수
src/lib/supabase/client.ts   # Supabase 브라우저 클라이언트
src/lib/supabase/server.ts   # Supabase 서버 클라이언트
src/lib/supabase/middleware.ts # 세션 갱신 미들웨어 유틸
src/lib/validations/      # Zod 스키마 (폼 검증)
```

---

## 3. 인증 패턴 — 필수 준수

### 서버 컴포넌트 (Server Component, RSC)

- `src/lib/supabase/server.ts`의 `createClient()` 사용
- `src/hooks/use-user.ts`의 `getUser()` 호출로 유저 확인
- `'use client'` 지시어 없이 사용

```ts
// 올바른 서버 컴포넌트 패턴
import { getUser } from '@/hooks/use-user'
const user = await getUser()
if (!user) redirect('/login')
```

### 클라이언트 컴포넌트 (Client Component)

- `src/lib/supabase/client.ts`의 `createClient()` 사용
- `src/hooks/use-auth.ts`의 `useAuth()` 훅 호출
- 반드시 `'use client'` 지시어 선언

```ts
// 올바른 클라이언트 컴포넌트 패턴
'use client'
import { useAuth } from '@/hooks/use-auth'
const { user, isLoading, signOut } = useAuth()
```

### **금지 사항**

- 서버 컴포넌트에서 `useAuth()` 호출 금지
- 클라이언트 컴포넌트에서 `src/lib/supabase/server.ts` import 금지
- `middleware.ts`에서 Prisma 직접 호출 금지 (워크스페이스 확인은 `app/dashboard/layout.tsx`에서 처리)

---

## 4. 미들웨어 규칙 (`middleware.ts`)

- 보호된 라우트: `/dashboard`, `/workspace-setup`
- 비로그인 전용 라우트: `/login`, `/signup`
- 미인증 시 `/login?redirectTo=...`으로 리다이렉트
- `src/lib/supabase/middleware.ts`의 `updateSession()`으로 세션 갱신 처리

---

## 5. Prisma 7 사용 규칙

### **중요**: Prisma 7은 기존 버전과 구성 방식이 다름

- **DB URL은 `prisma.config.ts`에서 관리** — `prisma/schema.prisma`에 url 설정하지 않음
- `prisma/schema.prisma`의 datasource 블록에는 `provider`만 명시

```ts
// prisma.config.ts — DB URL 설정 위치
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env['DATABASE_URL'] },
})
```

### Prisma CLI 명령어

```bash
npx prisma generate        # 클라이언트 생성 (스키마 변경 후 필수)
npx prisma migrate dev     # 마이그레이션 생성 및 적용
npx prisma studio          # DB GUI
```

### 스키마 변경 시 연동 파일

- `prisma/schema.prisma` 변경 → `npx prisma generate` 실행 필수
- 새 모델 추가 시 관련 API Route 및 Server Action도 함께 작성

---

## 6. 데이터 모델 요약

| 모델           | 관계                                            | 비고                                   |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `User`         | Workspace와 1:1                                 | Supabase Auth UID와 연동               |
| `Workspace`    | User 소유, ReportUpload·AdRecord·DailyMemo 포함 | 사업자 단위                            |
| `ReportUpload` | Workspace 소속, AdRecord 포함                   | Excel 업로드 이력                      |
| `AdRecord`     | Workspace + ReportUpload 소속                   | Excel 1행 = 1 AdRecord                 |
| `DailyMemo`    | Workspace 소속                                  | (workspaceId, campaignId, date) unique |

---

## 7. UI 컴포넌트 규칙

### shadcn/ui

- **스타일**: new-york
- **아이콘**: `lucide-react` 사용 (다른 아이콘 라이브러리 추가 금지)
- **신규 컴포넌트 추가**: `npx shadcn add [component]` 또는 `src/components/ui/`에 직접 생성
- **`components.json`** 확인 후 컴포넌트 경로 일치 여부 검증

### Tailwind CSS v4

- `tailwind.config.js` 파일 **없음** — v4는 CSS 파일(`app/globals.css`)에서 직접 설정
- `@theme` 블록으로 커스텀 토큰 정의
- `tw-animate-css` 패키지로 애니메이션 처리

---

## 8. 폼 처리 규칙

- **반드시** `react-hook-form` + `Zod`(v4) 조합 사용
- Zod 스키마는 `src/lib/validations/` 아래 도메인별 파일로 분리
- `@hookform/resolvers/zod`로 연결

```ts
// Zod v4 문법 사용 (v3와 일부 다름)
import { z } from 'zod'
export const schema = z.object({ ... })
```

---

## 9. 상태 관리 및 알림

- **전역 상태**: `zustand` 사용 (기존 Context 패턴으로 새 전역 상태 추가 금지)
- **토스트 알림**: `sonner` 사용 (`toast.success()`, `toast.error()`)
- 로컬 UI 상태는 `useState` 사용 가능

---

## 10. Excel 파싱 규칙

- **라이브러리**: `xlsx` (SheetJS) 사용
- Excel 파싱 로직은 Server Action 또는 API Route에서 처리 (클라이언트 처리 금지)
- 파싱 결과는 `AdRecord` 모델 구조에 맞게 변환 후 Prisma로 저장

---

## 11. 코드 작성 규칙

### 언어

- **주석**: 한국어
- **변수명·함수명·타입명**: 영어 (camelCase)
- **커밋 메시지**: 한국어, Conventional Commits 형식 + 이모지

### 포맷

- **들여쓰기**: 2칸 (스페이스)
- **TypeScript strict 모드** 활성화 — `any` 타입 사용 금지

### 컴포넌트 파일

- 클라이언트 컴포넌트는 파일 최상단에 `'use client'` 선언
- 서버 컴포넌트는 지시어 없이 작성 (기본값이 서버)
- 컴포넌트 파일명: kebab-case (예: `login-form.tsx`)

---

## 12. 환경 변수

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase 익명 키
DATABASE_URL                  # PostgreSQL 연결 문자열 (Prisma용)
```

- 서버 전용 환경 변수는 `NEXT_PUBLIC_` prefix 없이 사용
- `.env.local`에 저장, 절대 git에 커밋 금지

---

## 13. 다중 파일 연동 규칙

| 변경 대상                             | 함께 수정 필요한 파일                                      |
| ------------------------------------- | ---------------------------------------------------------- |
| `prisma/schema.prisma` 모델 추가/변경 | `npx prisma generate` 실행, 관련 API Route/Action 파일     |
| 새 라우트 추가                        | `middleware.ts` 보호 라우트 목록 확인, 필요 시 업데이트    |
| 새 Zod 스키마                         | `src/lib/validations/` 파일 생성 후 폼 컴포넌트에서 import |
| shadcn/ui 컴포넌트 추가               | `components.json` 자동 업데이트 확인                       |
| 새 전역 상태 추가                     | zustand store 파일 생성, 관련 컴포넌트에서 사용            |

---

## 14. AI 의사결정 기준

### 컴포넌트 배치 판단

1. 인증 관련 → `src/components/auth/`
2. 레이아웃(헤더·사이드바 등) → `src/components/layout/`
3. 마케팅 페이지 전용 → `src/components/marketing/`
4. 재사용 가능한 UI 원자 컴포넌트 → `src/components/ui/`
5. 페이지 전용 컴포넌트 → 해당 라우트 폴더 내부

### 데이터 페칭 판단

1. 초기 데이터 로딩 → 서버 컴포넌트에서 직접 Prisma 호출 또는 Server Action
2. 사용자 인터랙션으로 인한 데이터 변경 → Server Action 사용
3. 클라이언트 사이드 실시간 상태 → `useAuth()` 훅 또는 zustand

### 라우트 보호 판단

- 모든 `/dashboard/*` 하위 경로는 자동으로 `middleware.ts`로 보호됨
- 워크스페이스 미생성 리다이렉트는 `app/dashboard/layout.tsx` 서버 컴포넌트에서 처리

---

## 15. 금지 사항

- `any` 타입 사용 금지
- `middleware.ts`에서 Prisma 직접 호출 금지
- 서버 컴포넌트에서 `useAuth()`, `useState()`, `useEffect()` 호출 금지
- 클라이언트 컴포넌트에서 `src/lib/supabase/server.ts` import 금지
- `tailwind.config.js` 파일 새로 생성 금지 (v4는 CSS 기반 설정)
- `prisma/schema.prisma`에 `datasource` url 직접 작성 금지 (`prisma.config.ts` 사용)
- `lucide-react` 외 다른 아이콘 라이브러리 추가 금지
- Excel 파싱을 클라이언트 컴포넌트에서 직접 처리 금지
- `.env.local` 파일 git 커밋 금지
- `components/ui/` (루트)에 신규 shadcn 컴포넌트 추가 금지 (`src/components/ui/` 사용)
