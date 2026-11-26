# 모집 관리 기업 정보 설정 + 「매장」→「장소」 문구

- 작성: 2026-11-26, 브랜치 `feat/hiring-company-profile`(origin/develop 기준), 워크트리 `workdeck-app-hiring-company`
- 화면 계획(승인): `docs/design/plans/hiring-company-profile/`(settings-company·public-posting A안·place-wording)
- 후속 2단계: JobPosting(`docs/superpowers/plans/2026-11-25-job-posting-jsonld.md`, 이번 기업명을 hiringOrganization 출처로 고쳐 진행)

## 목표

1. 모집 관리 설정에 「기업 정보」 탭(맨 앞): 기업명·기업 소개·홈페이지·블로그·인스타그램·유튜브·「공고에 기업 소개 표시」 스위치.
2. 기업명 입력란 기본값 = 작업 공간 이름. **저장해야** 공고에 반영(저장 전 공개 화면 변화 없음).
3. 공개 공고(`/p/[uuid]`): 헤더를 카드 없는 2줄 머리글로 단순화(기업명 / 상태·마감·장소명). 지원 영역 아래 푸터형 기업 소개(카드 아님, 위 구분선·작은 회색 글씨) + 근무 장소 주소 + 링크. 스위치 끄면 푸터형 소개 숨김(기업명 머리글은 유지).
4. 모집 관리 화면 문구 「매장」→「장소」 전체(운영자 화면 + 공개 공고·지원서 + 사용자에게 보이는 API 오류 문구).

## 결정 (grill·미리보기 2026-11-26)

- 공간당 1개. 공고별 기업 정보·공고별 끄기는 범위 밖(공고 테이블 컬럼 추가 = 이관 targetHash 변경).
- 소개: 일반 텍스트(줄바꿈 유지) 최대 1,000자. 서식 편집기 안 씀.
- 링크: 고정 4칸, `https://` 만 허용, 각 최대 300자. 빈 칸은 공고에서 숨김.
- 표시 조건: 프로필 행이 있고 `companyName` 이 비어 있지 않을 때만 기업명 머리글. 푸터 영역(기업명·근무 장소)은 프로필이 있으면 항상, 그 안의 소개·링크는 `showIntro=true` 이고 값이 있을 때만. 근무 장소 주소는 어떤 조합에서도 화면에 남는다.
- 유지: URL `/settings/stores`, DB `HiringStore`, 코드 이름, 저장된 지원서 응답 값, 이관 코드, 마케팅 랜딩 문구(`src/lib/marketing/decks/recruiting.ts` — 고객 업종 설명이라 별개).

## 변경 파일

1. `prisma/schema.prisma` + `npx prisma migrate dev --name hiring_company_profile`
   ```prisma
   model HiringCompanyProfile {
     spaceId      String   @id
     companyName  String
     intro        String?
     homepageUrl  String?
     blogUrl      String?
     instagramUrl String?
     youtubeUrl   String?
     showIntro    Boolean  @default(true)
     space        Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
     updatedAt    DateTime @updatedAt
     createdAt    DateTime @default(now())
   }
   ```
   `Space` 에 `hiringCompanyProfile HiringCompanyProfile?` 역관계. 신규 테이블만 추가(기존 행 영향 없음, 백필 없음).
   생성된 `migration.sql` 끝에 `ALTER TABLE "HiringCompanyProfile" ENABLE ROW LEVEL SECURITY;` 를 직접 추가(HiringPostingMailSetting 마이그레이션과 같은 방식 — 실제 파일 대조). 검증: dev DB 에서 RLS 켜짐(`pg_class.relrowsecurity`) 확인, Prisma 서버 접근 정상.
2. `src/lib/validations/hiring-posts.ts` — `companyProfileSchema`: companyName trim 1~50, intro trim ≤1000 → 빈 값 null, URL 4개 trim → 빈 값 null, `z.string().url()` + `https:` 프로토콜 검사, ≤300; showIntro boolean.
3. `app/api/hiring-posts/company-profile/route.ts` — GET(`resolveDeckContext('recruiting')`) → `{ profile | null, defaultCompanyName: space.name }`; PUT(`{ write: true }`) upsert(spaceId = resolved.space.id 고정, 본문 spaceId 무시). 기존 stores 라우트와 같은 오류 형식.
4. `src/lib/deck-routes.ts` `RECRUITING_COMPANY_PATH = .../settings/company`; `settings-tabs.tsx` 탭 [기업 정보, 장소 관리, 직무 관리, 메시지 관리]; `app/d/recruiting/settings/page.tsx` 기본 리디렉트 → 기업 정보.
5. `app/d/recruiting/settings/company/page.tsx`(서버: 프로필·공간 이름 조회) + `src/components/hiring-posts/company-profile-form.tsx`(RHF+Zod, `Input`·`Textarea`·`Switch`·`Button`·`Badge`): 기업명 기본값 안내, 글자 수, 저장 상태 배지(「공고에 표시 중」/「아직 저장 안 됨」), 「공고에서 보기」(공간의 최근 ACTIVE 공고 uuid 가 있을 때만, 새 탭). 저장 실패 문구는 원인·다음 행동.
6. `app/p/[uuid]/page.tsx`:
   - `loadPosting` select 에 `space.hiringCompanyProfile` 추가(공고의 spaceId 로만 조인 — 다른 공간 값 섞일 경로 없음).
   - 헤더: Card 제거 → 머리글 2줄. 1줄 기업명(`text-base font-semibold`, 프로필 있을 때만). 2줄 `text-xs text-muted-foreground`: 상태 점+라벨(모집 중/마감/발행 전) · 마감 라벨(D-n, 상시 모집) · 장소명(1곳이면 이름, 여러 곳이면 「첫 장소 외 n곳」). 프로필 없는 공간은 주소를 지금처럼 머리글에 유지(정보 손실 방지).
   - 프로필 있는 공간: 장소 주소는 푸터 영역의 「근무 장소」 목록(이름 — 도로명 주소)으로 **항상** 표시(소개·링크·showIntro 와 무관). 즉 프로필이 있으면 푸터 영역은 항상 렌더되고, 소개·링크 부분만 `showIntro` 와 값 유무로 가린다.
   - 푸터형 소개 `CompanyFooter`(같은 파일 또는 `src/components/hiring-public/company-footer.tsx`): `border-t pt-6 text-sm text-muted-foreground`, 기업명 `text-sm font-medium text-foreground`, 소개 `whitespace-pre-line`, 링크는 lucide `Globe`·`BookOpen`·`Instagram`·`Youtube` + 글자 라벨, `Button variant="ghost" size="sm"`, `target="_blank" rel="noopener noreferrer nofollow"`. 위치: 본문 섹션 다음, 「워크덱으로 만든 채용 페이지」 위.
   - 미리보기(DRAFT)·마감 공고에도 같은 규칙(정보 표시일 뿐).
   - `generateMetadata` 변경 없음.
7. 「매장」→「장소」 문구: settings-tabs·settings/stores page·stores-manager·step-stores·content-block-editor·posting-preview·build-types(라벨)·postings.ts(사용자 문구)·applications/[id] page·hiring-public/apply-form·API 오류 문구(stores·postings/[id]/stores·hiring-public/applications)·validations 메시지. 지원자 목록·필터·메일 템플릿·MCP `hiring_*` 설명·SettingsTabs 테스트에서 추가로 grep 해 같은 규칙 적용. 주석·식별자·이관 코드는 그대로.
8. 테스트
   - 스키마: https 아닌 URL 거부, 빈 문자열→null, 길이 상한.
   - API: 미인증·타 deck 거부, 쓰기 가드(만료 공간) **402**(기존 `assertDeckWritable` 계약)·비활성 deck 403 구분, upsert 가 resolved.space.id 로만 저장, 본문 spaceId 무시.
   - 공개 페이지: 프로필 없음 → 기업명·푸터 없음 + 주소 머리글 유지; 기업명만 저장(소개·링크 없음) → 근무 장소 주소 표시; 여러 장소 → 머리글 「외 n곳」 + 주소 전부; showIntro=false → 소개·링크 없음 + 근무 장소 주소 유지; 링크 rel/target; 다른 공간 프로필이 섞이지 않음.
   - 설정 폼: 기본값=공간 이름, 저장 전 배지 「아직 저장 안 됨」.
   - 기존 테스트의 「매장」 문구 기대값 갱신.

## 검증

- jest(관련), `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- 라이브 작업대(dev, Profile 4): 설정 기업 정보 입력·저장 → 공개 공고(모바일 390·데스크톱) 캡처, axe 자가 확인, 와이어프레임과 나란히 비교.
- 운영 배포 후: 운영 테스트 계정 공간(memory `reference_prod_test_accounts`)에서 저장 → 공개 공고 표시 확인, 기존 고객 공고(프로필 없음) 화면이 머리글 단순화 외 정보 손실 없는지 1건 확인. 모바일은 미러링 규칙대로.

## 위험·롤백

- 머리글 단순화는 모든 공개 공고에 적용(기업 정보 미입력 공간 포함). 정보는 유지하고 시각 비중만 바뀜 — 에디 승인(11-26).
- 롤백: **애플리케이션 코드만 되돌린다**(공개 페이지·설정·API·문구). 적용된 `migration` 파일과 `schema.prisma` 의 모델은 남긴다 — 운영은 빌드 때 `prisma migrate deploy` 가 돌아 파일을 지우면 이력이 어긋난다. 남은 테이블은 미사용이라 무해. 배포 실패 시 재시도는 같은 마이그레이션 그대로(신규 테이블이라 멱등 문제 없음, 실패 시 `_prisma_migrations` 상태 확인 후 `migrate resolve` — 운영 DB 직접 SQL 금지).
- 개인정보: 기업 정보는 공개용 값만. 담당자·지원자 정보 미포함.

## Codex 검토 반영 (2026-11-26) — 지적 4건, 반영 4

1. [high] 기업명만 저장 시 주소 사라짐 → 근무 장소 주소를 소개 표시와 분리, 프로필 있으면 항상 표시 + 테스트 2건.
2. [high] 신규 테이블 RLS 누락 → migration.sql 에 ENABLE ROW LEVEL SECURITY + dev 검증.
3. [medium] PR revert 시 마이그레이션 이력 불일치 → 롤백은 앱 코드만, 마이그레이션·모델 유지.
4. [medium] 만료 공간 응답 403 → 기존 계약 402 로 테스트.
