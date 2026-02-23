# 배포 가이드

## 개요

쿠팡 광고 리포트 매니저는 **Vercel + Supabase** 조합으로 배포한다.
`vercel.json`은 이미 구성 완료 상태이며, 아래 절차에 따라 프로덕션 배포를 진행한다.

### 현재 `vercel.json` 설정

```json
{
  "framework": "nextjs",
  "buildCommand": "npx prisma generate && next build",
  "installCommand": "npm install",
  "regions": ["icn1"]
}
```

- `buildCommand`: Prisma 클라이언트 생성 후 Next.js 빌드 (Prisma 7 필수 순서)
- `regions`: 서울 리전(`icn1`) — 쿠팡 사용자 지연 최소화

---

## Supabase 프로젝트 전략

### 현재 전략 (A안): 기존 프로젝트 승격

개발에 사용 중인 Supabase 프로젝트를 그대로 프로덕션으로 사용한다.
별도 프로젝트 생성 없이 `.env.local`의 값을 Vercel 환경변수에 그대로 등록하면 된다.

**이 방식이 적합한 이유:**

- `coupang-ad-manager`는 Workdeck 플랫폼의 첫 번째 카드 — 향후 기능 확장도 동일 프로젝트에서 진행
- 초기 단계에서 Supabase 무료 플랜 하나로 충분
- 인증(Auth) / 워크스페이스 / DB 테이블이 모두 같은 프로젝트에서 누적 관리됨

### 향후 전환 (B안): 개발/프로덕션 분리

유료 구독 연동(Stripe), 멀티테넌시 확장, 또는 팀 협업이 필요한 시점에 분리를 고려한다.

**전환 절차 (필요 시):**

1. Supabase 대시보드에서 신규 프로덕션 프로젝트 생성
2. 신규 프로젝트 DB에 마이그레이션 적용:
   ```bash
   DATABASE_URL=<신규_프로덕션_DB_URL> npx prisma migrate deploy
   ```
3. Vercel 환경변수를 신규 프로젝트 값으로 교체 후 재배포
4. 기존 프로젝트는 로컬 개발 전용으로 유지

---

## 1. 사전 준비: Supabase 연결 정보 확인

현재 개발에 사용 중인 Supabase 프로젝트의 정보를 확인한다.

1. [Supabase 대시보드](https://supabase.com/dashboard) → 프로젝트 선택
2. 다음 값을 복사:
   - **Project URL**: Settings → API → Project URL
   - **anon public key**: Settings → API → Project API keys → `anon public`
   - **Database URL**: Settings → Database → Connection string → URI 모드

> 이 값들이 `.env.local`에 이미 설정되어 있다면 별도로 복사할 필요 없이 해당 파일을 참조한다.

---

## 2. 환경변수 등록 (Vercel 대시보드)

Vercel 프로젝트 생성 후 Settings → Environment Variables에서 등록:

| 변수명                          | 환경                             | 값                               |
| ------------------------------- | -------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Production, Preview, Development | Supabase Project URL             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development | Supabase anon public key         |
| `DATABASE_URL`                  | Production                       | Database connection string (URI) |

> **주의**: `DATABASE_URL`은 절대 `NEXT_PUBLIC_` 접두사를 붙이지 않는다 (서버 전용).
> 브라우저에 노출되면 DB 직접 접근이 가능해지므로 반드시 서버 전용으로 유지한다.

---

## 3. Vercel 배포 실행

### 3-1. Vercel CLI 설치 및 로그인

```bash
npm install -g vercel
vercel login
```

### 3-2. 프로젝트 연결 (최초 1회)

```bash
# 프로젝트 루트에서 실행
vercel
```

프롬프트 응답:

- Set up and deploy? → `Y`
- Which scope? → 본인 계정 선택
- Link to existing project? → `N` (신규) 또는 `Y` (기존 연결)
- Project name: `coupang-ad-manager`
- In which directory is your code located? → `./` (기본값)

### 3-3. 프로덕션 배포

```bash
vercel --prod
```

빌드 로그에서 다음 순서 확인:

1. `npm install` 실행
2. `npx prisma generate` 실행
3. `next build` 실행
4. 배포 URL 출력

---

## 4. 도메인 연결 (`app.workdeck.work`)

1. Vercel 대시보드 → Project → Settings → Domains
2. `app.workdeck.work` 입력 후 Add
3. DNS 레코드 설정 (도메인 관리 패널에서):
   - 타입: `CNAME`
   - 이름: `app`
   - 값: `cname.vercel-dns.com`
4. DNS 전파 후 (최대 48시간) Vercel에서 자동 HTTPS 인증서 발급

> Vercel이 제공하는 기본 도메인(`*.vercel.app`)으로도 즉시 접근 가능.

---

## 5. 배포 후 스모크 테스트

배포 완료 후 아래 시나리오를 순서대로 검증한다:

- [ ] **회원가입**: 이메일 + 비밀번호 회원가입 → 이메일 인증 → 로그인
- [ ] **구글 OAuth**: 구글 로그인 → 워크스페이스 설정 화면 이동 확인
- [ ] **워크스페이스 설정**: 이름 입력 후 저장 → 대시보드 이동 확인
- [ ] **리포트 업로드**: `.xlsx` 파일 업로드 → 성공 메시지 및 행 수 확인
- [ ] **캠페인 목록**: 대시보드에 업로드한 캠페인 목록 표시 확인
- [ ] **캠페인 상세**: 클릭 → 대시보드/광고데이터/키워드분석 탭 동작 확인
- [ ] **메모 작성**: 날짜 선택 → 메모 입력 → 저장 → 재조회 확인
- [ ] **로그아웃**: 세션 종료 → `/login` 리다이렉트 확인

---

## 6. 롤백 절차

### Vercel 대시보드에서 롤백

1. Vercel 대시보드 → Project → Deployments
2. 롤백할 이전 배포 선택
3. `...` 메뉴 → **Promote to Production** 클릭

### Git 기반 롤백

```bash
# 이전 커밋으로 되돌리기
git revert HEAD
git push origin main
# Vercel이 자동으로 새 배포 시작
```

### DB 마이그레이션 롤백

Prisma는 기본적으로 마이그레이션 다운 롤백을 지원하지 않는다.
스키마 변경을 되돌리려면 새 마이그레이션을 작성해 적용한다:

```bash
npx prisma migrate dev --name revert_[변경명]
```

---

## 부록: 로컬 개발 환경 설정

```bash
# 저장소 클론 후
npm install

# .env.local 생성 (Supabase 프로젝트 연결 정보 입력)
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# DATABASE_URL=

# DB 마이그레이션
npx prisma generate
npx prisma migrate dev

# 개발 서버 시작
npm run dev
```
