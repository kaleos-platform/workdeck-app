# Workdeck 배포 및 운영 실행 계획서

**작성일:** 2026-02-23
**상태:** 실행 대기 (Phase 1 준비 중)

## 1. 개요

본 문서는 "나만의 업무 카드를 꽂아 쓰는 Business OS"인 **Workdeck**의 첫 번째 카드로서 `coupang-ad-manager`를 성공적으로 론칭하고, 플랫폼을 확장하기 위한 구체적인 기술 및 운영 실행 계획을 담고 있다.

## 2. 핵심 전략 가이드라인

- **도메인 정책:** `workdeck.work` 하위 서브도메인을 즉시 활용하여 브랜드 권위를 통합한다. (`app.workdeck.work`)
- **수익화 모델:** **Stripe**를 연동하여 글로벌 확장이 용이한 구독 및 사용량 기반 과금(Base + Usage) 모델을 적용한다.
- **MVP 기능 범위:** 쿠팡 광고센터 API의 제한을 고려하여, **진단 리포트(분석 및 추천)** 가치 제공에 집중하며 자동 실행 기능은 단계적으로 확장한다.

## 3. 단계별 로드맵

### [Phase 1] 서비스 론칭 및 초기 운영 (First Value 검증)

- **목표:** 데이터 업로드 후 5분 내에 핵심 인사이트를 제공하여 제품의 가치를 증명한다. (TTFV 최적화)
- **주요 과제:**
  - **분석 로직 고도화:** 현재 구현된 엑셀 파서와 메트릭 계산기를 기반으로 "오늘의 낭비 예산" 및 "성과 개선 액션 5선" 도출 로직 강화.
  - **프로덕션 인프라 구축:** Vercel 배포 및 `app.workdeck.work` 연결, Supabase 프로덕션 프로젝트 설정.
  - **데이터 격리:** 테넌트(Organization) 기반의 RLS(Row Level Security) 정책을 최종 점검하여 멀티테넌시 보안 확보.

### [Phase 2] Workdeck OS 전환 및 수익화

- **목표:** 개별 서비스를 Workdeck 플랫폼의 "카드"로 전환하고 유료화를 시작한다.
- **주요 과제:**
  - **Stripe 결제 통합:** Stripe Billing/Checkout 연동을 통한 구독 관리 및 결제 UI 구현.
  - **Metering 시스템:** 리포트 생성 및 데이터 분석 세션에 대한 사용량 측정 및 Stripe Usage 기록 동기화.
  - **아키텍처 재구조화:** Auth, Billing, Workspace 관리 로직을 공통 레이어로 분리하여 향후 카드 추가 시 재사용 가능한 구조로 개선.

### [Phase 3] 서비스 확장 및 글로벌 진출 준비

- **목표:** 추가 카드를 론칭하고 해외 시장에 대한 실험을 시작한다.
- **주요 과제:**
  - **OSMU Content Card 개발:** 광고 데이터를 활용한 AI 소셜 광고 카피 자동 생성 모듈 추가.
  - **글로벌 로컬라이제이션:** `/kr`, `/jp` 등 디렉토리 기반 URL 구조 적용 및 다국어 SEO 최적화.
  - **해외 커넥터 PoC:** 일본 시장을 타겟으로 한 Shopify Admin API 연동 및 데이터 동기화 실험.

## 4. 기술 스택 및 아키텍처

- **Core Framework:** Next.js 15+ (App Router)
- **Infrastructure:** Supabase (Auth, DB, Storage)
- **ORM:** Prisma (PostgreSQL)
- **Payments:** Stripe (Subscription & Metered Billing)
- **Styling:** Tailwind CSS v4 + Shadcn UI
- **Observability:** 실행 로그 및 미터링 이벤트 추적 레이어 구축

## 5. 향후 액션 아이템 (우선순위 순)

1. **Stripe 연동:** SDK 설치 및 구독 플랜(Starter/Pro) 메타데이터 정의.
2. **Organization 스키마 보완:** 사용자 소속 및 카드 활성화 상태 관리를 위한 DB 스키마 업데이트.
3. **진단 리포트 UI 강화:** 분석 결과를 한눈에 파악할 수 있는 요약 대시보드 고도화.
