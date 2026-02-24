# 스모크 테스트 절차

## 개요

프로덕션 배포 후 핵심 플로우가 정상 동작하는지 검증하는 단계별 절차.
배포 후 15분 이내에 완료할 수 있도록 설계되어 있다.

**대상 환경:** https://coupang-ad-manager-iota.vercel.app
**참고:** 배포 절차는 [deployment.md](./deployment.md#5-배포-후-스모크-테스트) 참조

---

## Step 1: 회원가입

1. https://coupang-ad-manager-iota.vercel.app/signup 접속
2. 테스트용 이메일 + 비밀번호 입력 후 제출

**기대 결과:**

- [ ] "이메일을 확인하세요" 안내 메시지 표시
- [ ] 입력한 이메일로 인증 메일 수신

**에러 시 확인:**

- Supabase 대시보드 → Authentication → Logs에서 에러 확인
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 환경변수 등록 여부 확인

---

## Step 2: 이메일 인증 및 로그인

1. 수신한 이메일에서 "Confirm your mail" 링크 클릭
2. `/login` 페이지에서 이메일 + 비밀번호 입력

**기대 결과:**

- [ ] 이메일 인증 완료 후 로그인 성공
- [ ] 워크스페이스가 없으면 `/workspace-setup`으로 이동

**에러 시 확인:**

- Supabase 대시보드 → Authentication → URL Configuration에서 `Site URL` 확인
- 프로덕션 URL이 Redirect URLs에 등록되어 있는지 확인

---

## Step 3: 워크스페이스 설정

1. `/workspace-setup` 페이지에서 워크스페이스 이름 입력
2. "저장" 버튼 클릭

**기대 결과:**

- [ ] 저장 성공 후 `/dashboard`로 이동
- [ ] 대시보드에 "업로드된 리포트 없음" 또는 빈 캠페인 목록 표시

**에러 시 확인:**

- Vercel 함수 로그에서 `/api/workspace` POST 응답 확인
- `DATABASE_URL` 환경변수 등록 여부 확인

---

## Step 4: 구글 OAuth 로그인 (선택)

1. `/login` → "구글로 로그인" 클릭
2. 구글 계정 선택

**기대 결과:**

- [ ] 구글 인증 완료 후 `/workspace-setup` 또는 `/dashboard`로 이동

**에러 시 확인:**

- Supabase → Authentication → Providers → Google이 활성화되어 있는지 확인
- Google Cloud Console → 승인된 리다이렉트 URI에 `https://[project].supabase.co/auth/v1/callback` 등록 여부 확인

---

## Step 5: 리포트 업로드

1. `/dashboard/upload` 접속
2. 쿠팡 셀러센터에서 다운로드한 `.xlsx` 파일 드래그 또는 클릭하여 선택
3. "업로드" 버튼 클릭

**기대 결과:**

- [ ] "N개 행 저장 완료" 토스트 메시지 표시
- [ ] `/dashboard`로 자동 이동

**에러 시 확인:**

- 파일이 쿠팡 셀러센터 광고 리포트 형식인지 확인 (KEYWORD 또는 NCA 포맷)
- 컬럼 오류 메시지 → 누락 컬럼 목록 확인 후 올바른 파일 사용
- 상세: [runbook.md — 업로드 실패](./runbook.md#1-업로드-실패)

---

## Step 6: 캠페인 목록 확인

1. `/dashboard` 접속 또는 업로드 후 자동 이동

**기대 결과:**

- [ ] 업로드한 데이터의 캠페인 목록 카드 표시
- [ ] 각 캠페인 카드에 기간, 광고비, ROAS 정보 표시

**에러 시 확인:**

- Vercel 함수 로그에서 `/api/campaigns` GET 응답 확인

---

## Step 7: 캠페인 상세 — 3개 탭

1. 캠페인 카드 클릭
2. **대시보드 탭**: 성과 추이 차트 확인
3. **광고 데이터 탭**: 원시 데이터 테이블 확인
4. **키워드 분석 탭**: 비효율 키워드 목록 확인

**기대 결과:**

- [ ] 각 탭 전환 시 데이터 로드 완료
- [ ] 성과 추이 차트에 날짜별 데이터 포인트 표시
- [ ] 광고 데이터 탭 페이지네이션 동작

---

## Step 8: 메모 작성

1. 캠페인 상세 → 대시보드 탭
2. 차트에서 날짜 클릭 또는 메모 아이콘 클릭
3. 메모 내용 입력 후 저장
4. 페이지 새로고침 후 메모 재확인

**기대 결과:**

- [ ] 메모 저장 성공 알림
- [ ] 새로고침 후 동일 날짜에 메모 내용 유지

---

## Step 9: 로그아웃

1. 우측 상단 사용자 메뉴 → 로그아웃

**기대 결과:**

- [ ] 로그아웃 후 `/login`으로 리다이렉트
- [ ] `/dashboard` 직접 접근 시 `/login`으로 리다이렉트

---

## 통과 기준

9개 Step 중 핵심 5개 (Step 3, 5, 6, 7, 9) 모두 통과 시 배포 성공으로 판정한다.
Step 4 (구글 OAuth)는 선택 검증 항목이다.
