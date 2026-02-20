# 쿠팡 광고 리포트 매니저

쿠팡 광고 리포트 Excel을 업로드·분석해 비효율 광고비를 절감하고 ROAS를 개선하는 웹 서비스입니다.

## 프로젝트 개요

**목적**: 쿠팡 광고 리포트 Excel 업로드 및 분석을 통한 광고비 절감과 ROAS 개선

**사용자**: 쿠팡 광고를 직접 운영하는 1인 셀러 또는 소규모 쇼핑몰 운영자

## 주요 페이지

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 랜딩 페이지 | `/` | 서비스 소개 및 회원가입 CTA |
| 로그인 | `/login` | 이메일·비밀번호 로그인 |
| 회원가입 | `/signup` | 신규 계정 생성 |
| 워크스페이스 설정 | `/workspace-setup` | 쿠팡 사업자명 기반 최초 설정 (1회) |
| 대시보드 | `/dashboard` | 전체 워크스페이스 성과 요약 |
| 리포트 업로드 | `/dashboard/upload` | Excel 파일 업로드 및 파싱 |
| 캠페인 상세 | `/dashboard/campaigns/[campaignId]` | 캠페인별 분석 (3개 탭) |

## 핵심 기능

- **Excel 리포트 업로드 (F001)**: .xlsx 파일 파싱 후 DB 저장, 캠페인 목록 자동 갱신
- **ROAS 시계열 분석 (F002)**: 날짜별 ROAS·광고비·클릭수·노출수 Recharts 차트
- **비효율 키워드 발견 (F003)**: 광고비 > 0 & 주문수 = 0 키워드 자동 필터링 및 클립보드 복사
- **광고 데이터 테이블 (F004)**: 컬럼 정렬·필터·페이지 크기 설정
- **일자별 메모 (F005)**: 캠페인별 광고 작업 이력 CRUD
- **날짜 범위 필터 (F006)**: 분석 기간 설정 (모든 탭 공통)
- **광고유형 필터 (F007)**: 광고유형 선택 필터 (모든 탭 공통)

## 기술 스택

| 분류 | 기술 |
|------|------|
| Framework | Next.js 16 (App Router, RSC) |
| Runtime | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui (new-york 스타일) |
| Icons | Lucide React |
| Form | React Hook Form + Zod |
| Chart | Recharts |
| Auth | Supabase Auth (SSR) |
| ORM | Prisma 7 |
| Database | PostgreSQL (Supabase) |
| State | Zustand |
| File Parsing | xlsx (SheetJS) |
| Deployment | Vercel |

## 시작하기

```bash
# 의존성 설치
npm install

# xlsx 패키지 추가 설치 (Excel 파싱용)
npm install xlsx

# 환경 변수 설정
# .env.local에 아래 변수 추가
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# DATABASE_URL=

# Prisma 클라이언트 생성
npx prisma generate

# 개발 서버 실행
npm run dev

# 빌드
npm run build
```

## 개발 상태

- [x] 기본 프로젝트 구조 설정
- [x] Supabase 인증 (로그인·회원가입·로그아웃)
- [x] 워크스페이스 설정 페이지
- [x] 대시보드 기본 구조
- [x] 파일 업로드 페이지 UI
- [x] 캠페인 상세 페이지 탭 구조
- [x] Prisma 스키마 (Workspace/ReportUpload/AdRecord/DailyMemo)
- [ ] Excel 파싱 및 DB 저장 로직 (xlsx + API Route)
- [ ] Recharts 시계열 차트 연동
- [ ] 실제 캠페인 데이터 API 연동
- [ ] 비효율 키워드 필터링 로직
- [ ] 일자별 메모 CRUD

## 문서

- [PRD 문서](./docs/prd.md) - 상세 요구사항
- [개발 가이드](./CLAUDE.md) - Claude Code 개발 지침
