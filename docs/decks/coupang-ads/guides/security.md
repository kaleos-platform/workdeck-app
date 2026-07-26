# 보안 가이드

## 개요

쿠팡 광고 리포트 매니저는 **Supabase Auth + Prisma + PostgreSQL** 구조로, 모든 데이터 접근은 서버 측에서만 이루어진다.
보안은 세 계층으로 구성된다: 미들웨어(라우트 보호) → 인증(사용자 검증) → 인가(워크스페이스 소유권 검증).

---

## 1. 인증 레이어

### 1-1. 미들웨어 라우트 보호 (`proxy.ts`)

```
GET /dashboard/** → 미로그인 시 /login 리다이렉트
GET /workspace-setup → 미로그인 시 /login 리다이렉트
GET /login, /signup → 로그인 상태면 /dashboard 리다이렉트
```

- Next.js 16의 `proxy.ts`가 모든 요청을 가로채 세션 갱신(`updateSession`) 및 라우트 보호를 수행한다.
- `api/` 경로는 미들웨어에서 리다이렉트하지 않고, 각 API 라우트 핸들러에서 401로 응답한다.

### 1-2. 서버 컴포넌트 인증 (`src/hooks/use-user.ts`)

```typescript
// 서버 컴포넌트 및 API 라우트에서 사용
const user = await getUser()
if (!user) return errorResponse('인증이 필요합니다', 401)
```

- Supabase Auth 세션 쿠키를 검증해 유효한 사용자 UUID를 반환한다.
- 세션 만료 시 `null` 반환 → 401 응답.

---

## 2. 인가 레이어: `resolveWorkspace()`

```typescript
// src/lib/api-helpers.ts
export async function resolveWorkspace() {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id }, // 반드시 본인 소유 워크스페이스만 조회
    select: { id: true },
  })
  if (!workspace) return { error: errorResponse('워크스페이스가 없습니다', 404) }

  return { user, workspace }
}
```

**보안 효과:**

- `workspace.id`는 인증된 사용자 UUID(`user.id`)와 결합된 소유권 검증을 통해서만 획득된다.
- 이후 모든 DB 쿼리는 이 `workspace.id`를 `where` 조건에 포함 → 타 사용자 데이터 접근 불가.

**적용 현황 (7개 라우트):**

| 라우트                                             | 메서드           | resolveWorkspace() |
| -------------------------------------------------- | ---------------- | ------------------ |
| `/api/campaigns`                                   | GET              | ✅                 |
| `/api/campaigns/[campaignId]`                      | PATCH, DELETE    | ✅                 |
| `/api/campaigns/[campaignId]/metrics`              | GET              | ✅                 |
| `/api/campaigns/[campaignId]/records`              | GET              | ✅                 |
| `/api/campaigns/[campaignId]/memos`                | GET, POST, PATCH | ✅                 |
| `/api/campaigns/[campaignId]/inefficient-keywords` | GET              | ✅                 |
| `/api/reports/upload`                              | POST             | ✅                 |

**예외 — `/api/workspace` (POST):**
워크스페이스 최초 생성 라우트이므로 `resolveWorkspace()`를 사용할 수 없다(아직 워크스페이스가 없음).
대신 `getUser()`로 사용자를 검증하고, `ownerId: user.id`로 소유권을 강제한다.

---

## 3. 테넌트 격리

### 3-1. 데이터 모델 격리

모든 테이블(`AdRecord`, `ReportUpload`, `DailyMemo`, `CampaignMeta`)에 `workspaceId` 컬럼이 있으며,
Prisma 스키마에서 `onDelete: Cascade`로 워크스페이스 삭제 시 연관 데이터 전체 삭제가 보장된다.

```prisma
model AdRecord {
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  ...
}
```

### 3-2. 격리 패턴

```typescript
// 모든 DB 쿼리에 workspace.id 강제 포함
await prisma.adRecord.findMany({
  where: {
    workspaceId: workspace.id, // resolveWorkspace()에서 획득한 값
    campaignId, // URL 파라미터는 추가 필터일 뿐
  },
})
```

URL의 `campaignId` 파라미터는 데이터 격리 조건이 아닌 **추가 필터**로만 동작한다.
`workspaceId`가 먼저 강제되므로 타 사용자의 `campaignId`를 URL에 입력해도 본인 워크스페이스 데이터만 반환된다.

---

## 4. Supabase RLS 현황

| 항목                      | 현황                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| 클라이언트 직접 DB 접근   | **없음** — 모든 DB 접근은 서버 측 Prisma를 통해서만 이루어짐        |
| Supabase anon key DB 접근 | **없음** — `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 Auth 세션용으로만 사용 |
| RLS 필요성                | 낮음 — 서버 측 격리로 충분하지만, 추가 방어 계층으로 활성화 권장    |

**RLS 현황 확인 방법:**

1. Supabase 대시보드 → Authentication → Policies
2. 각 테이블(adrecords, workspaces 등)의 RLS 활성화 여부 확인
3. RLS 비활성화 상태라도 서버 측 격리가 동작하므로 즉각적인 위험은 없음

---

## 5. 환경변수 관리

### 로컬 개발

```bash
# .env.local (절대 git에 커밋하지 말 것 — .gitignore에 .env* 패턴 포함됨)
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://...
```

### 프로덕션 (Vercel)

Vercel 대시보드 → Project → Settings → Environment Variables에서 등록:

| 변수명                          | 환경                | 설명                               |
| ------------------------------- | ------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Production, Preview | Supabase 프로젝트 URL              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | Supabase 공개 키 (Auth 전용)       |
| `DATABASE_URL`                  | Production          | PostgreSQL 연결 문자열 (서버 전용) |

> **주의**: `DATABASE_URL`은 `NEXT_PUBLIC_` 접두사 없이 서버 전용으로 유지한다.
> 브라우저에 노출되면 DB 직접 접근이 가능해지므로 절대 공개 변수로 설정하지 않는다.

### 개발/프로덕션 분리

- 로컬: 개발용 Supabase 프로젝트 + `DATABASE_URL`
- 프로덕션: 별도 Supabase 프로젝트 생성 후 Vercel에 등록

---

## 6. 민감정보 체크리스트

배포 전 다음 항목을 반드시 확인한다:

- [ ] `.env.local` 파일이 git에 포함되지 않았는지 확인 (`git status` 또는 `git log --oneline`)
- [ ] `DATABASE_URL`이 `NEXT_PUBLIC_` 접두사 없이 사용되고 있는지 확인
- [ ] Vercel 환경변수에 프로덕션 Supabase 프로젝트 URL이 등록되었는지 확인
- [ ] 프로덕션과 개발 Supabase 프로젝트가 분리되어 있는지 확인
- [ ] Supabase 대시보드에서 서비스 롤 키(`service_role`)가 코드에 노출되지 않았는지 확인
- [ ] `npm run build`가 타입 에러 없이 통과하는지 확인
