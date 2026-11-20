# 설정 화면 초보자 개선 — 1단계 (사이드바·팀원·AI 설정)

- 날짜: 2026-11-20
- 브랜치: `feat/settings-ux-beginner` (origin/develop 기준)
- 와이어프레임: `docs/design/plans/settings-beginner-ux/` (승인됨). 번호 ①~⑲는 그 `plan.md`와 같다
- 대상 사용자: 비개발 셀러·소상공인

## 목표

설정 메뉴를 "매일 쓰는 메뉴"와 분리하고, 메뉴·화면 이름을 쉬운 말로 바꾼다. 팀원 화면은 주제별 탭과 초대 팝업으로, AI 설정은 % 사용량·로고 공급자 선택·키 발급 안내로 다듬는다. **서버·DB·권한 변경 없음.**

2단계(외부 서비스 연결 그리드·팝업·팀원용 상태 API)와 3단계(Meta·Google·네이버 검색광고 입력 팝업)는 별도 계획으로 진행한다. 이 문서 범위가 아니다.

## 변경 파일과 단계

### A. 사이드바 (①②③) — `src/components/layout/sidebar.tsx`

workdeck 셸 블록(현재 485~600행)만 바꾼다. 다른 업무 사이드바는 손대지 않는다.

1. 위쪽 RailLink: `홈`(/my-deck), `AI 요청 승인`(APPROVALS_PATH, 건수 배지 유지)
2. 그 아래 `사용 중인 업무` 섹션(기존 마크업 그대로, 위치만 위로)
3. 맨 아래 `설정` 그룹: 기존 `SidebarSection`(접힘 그룹, 현재 경로가 속하면 처음부터 펼침)을 재사용한다. 항목은 권한별로 배열을 만든다
   - 누구나: 외부 서비스 연결, 계정 설정(SETTINGS_ACCOUNT_PATH 신규 노출)
   - ADMIN 이상(`canAdmin`): AI 설정, 팀원 초대·관리
   - OWNER(`isOwner`): 업무 구독, 결제 수단·내역
   - 아이콘: `Settings`. 접힌 사이드바에서는 아이콘 클릭 시 사이드바 펼침(SidebarSection 기존 동작)
   - `SidebarSection`은 지금 `sectionIsActive`를 `useState` 초기값으로만 쓴다. 다른 화면에서 헤더 링크 등으로 설정 경로에 들어와도 펼쳐지도록, 비활성→활성으로 바뀔 때 `isOpen`을 true로 맞춘다(사용자가 접은 상태는 같은 섹션 안에서 이동할 때 유지). 다른 업무 사이드바에도 같은 개선이 적용된다
4. 모바일(`mobile-navigation.tsx`)은 같은 `Sidebar`를 쓰므로 별도 변경 없음
5. 헤더 계정 메뉴(`header.tsx` 74행)의 계정 설정 링크는 그대로 둔다(두 곳 진입)

### B. 이름 변경 — 화면 제목과 안내 문구

| 지금              | 바꾼 뒤          | 파일                                                                                                                                                                                                                                              |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 연동 설정         | 외부 서비스 연결 | `app/settings/integrations/page.tsx` h1, `coupang-source-card.tsx:146`, `deck-slack-notify-card.tsx:138`, `analysis-schedule.tsx:250`, `location-manager.tsx:454,480`(→ "외부 서비스 연결 → 비밀값"), `credential-health.ts:124`(Slack 알림 문구) |
| 승인 대기(메뉴)   | AI 요청 승인     | 사이드바, `mcp-guide-card.tsx:87`                                                                                                                                                                                                                 |
| 구독 업무 관리    | 업무 구독        | `app/settings/billing/page.tsx` h1, `payment-settings-client.tsx:126`                                                                                                                                                                             |
| 결제 관리         | 결제 수단·내역   | `app/settings/payments/page.tsx` h1, `app/settings/account/page.tsx:12`                                                                                                                                                                           |
| 구성원(메뉴·제목) | 팀원 초대·관리   | `app/settings/members/page.tsx` h1                                                                                                                                                                                                                |

- URL은 바꾸지 않는다(`/settings/integrations` 등 그대로). 리다이렉트 불필요
- 바꾸지 않는 것: 승인 화면 안의 "승인 대기 중인 액션" 같은 상태 표현, 관리자 콘솔(`app/admin/billing`) 제목, 코드 주석, 에이전트 도구 설명(LLM용)
- 역할 표시는 기존 `ROLE_LABEL`(소유자·관리자·구성원)·`ROLE_HINT`(`space-switcher.tsx`)를 재사용한다. 와이어프레임의 "팀원" 역할명은 작업 공간 전환 메뉴와 용어를 맞추려고 "구성원"으로 둔다

### C. 팀원 초대·관리 화면 (⑫⑬⑭) — `app/settings/members/page.tsx`, `src/components/settings/members-card.tsx`

1. 탭 상태는 URL이 단일 기준이다(controlled `Tabs`). `useSearchParams()`로 읽고, 허용값(`members` 기본·`invites`·`rules`) 밖이면 `members`. 탭을 바꾸면 기존 query를 보존한 채 `tab`만 바꿔 `router.replace(…, { scroll: false })`. 같은 화면에서 주소가 바뀌어도 선택 탭이 따라간다
2. 역할별 화면(서버 가드와 일치: 초대 목록·역할 변경·내보내기·한도 변경 API는 OWNER 전용)
   - OWNER: 탭 3개 + `[팀원 초대]` 버튼 + 역할 변경·내보내기·한도 변경
   - ADMIN: 탭 `팀원·권한`(역할은 글자로만, 조작 없음)·`승인 규칙`(한도 보기만). `초대` 탭과 초대 버튼은 숨기고, `?tab=invites`로 들어오면 `members`로 보낸다
3. 탭 ① 팀원·권한: 구성원 목록 + (OWNER) 역할 변경 Select(라벨 `ROLE_LABEL`)·내보내기. 목록 아래에 역할 안내(`ROLE_HINT` 3줄)
4. 탭 ② 초대(OWNER): 초대 내역(상태 배지·다시 보내기·취소·다시 초대, 기존 로직 그대로). 탭 라벨에 대기 건수
5. 탭 ③ 승인 규칙: 지출 승인 한도(기존 로직 그대로)
6. `[팀원 초대]` → `Dialog`: 이메일, 역할(native radio 2개 + 설명), `[초대 보내기]`
7. **초대 결과는 한 곳에서 보여 준다.** 신규 초대·다시 보내기·다시 초대 모두 지금처럼 `created` 상태에 결과(메일 성공/실패 문구, 링크 복사, 만료일)를 남기고, 이 결과를 `초대` 탭 맨 위 Alert로 표시한다. 팝업에서 초대가 성공하면 팝업을 닫고 `초대` 탭으로 이동한다. 실패(요청 오류)는 팝업 안에 오류 문구로 남긴다
8. 데이터 조회·변경 API와 상태 관리는 지금 코드를 그대로 옮긴다. 컴포넌트가 커지면 탭별 하위 컴포넌트로 나누되 같은 파일 또는 `src/components/settings/members/` 안에서 끝낸다

### D. AI 설정 (⑮⑯⑰) — `src/components/settings/ai-settings-form.tsx`

1. 사용량: "이번 달 무료 사용량 N% 사용" + Progress, 토큰 수는 `text-xs text-muted-foreground`로 한 줄
2. 공급자 선택: Select → 로고 타일 3개. `fieldset`+`legend` 안의 native `<input type="radio" class="sr-only">`를 `label` 타일로 감싼다(방향키 이동·선택 상태를 브라우저가 제공, 새 의존성 없음). 포커스 링은 타일에 `has-[:focus-visible]:ring`. 로고는 각 사 공식 브랜드 자료의 SVG를 `public/brand/`(openai·anthropic·gemini)에 두고 `<img>`로만 렌더(인라인 SVG 금지). 공식 파일을 못 구하면 이름 텍스트 타일로 두고 보고한다
3. "키는 어디서 받나요?" 접기(native `<details>/<summary>`, 새 의존성 없음): 공급자별 1~3단계 + 콘솔 링크(OpenAI `platform.openai.com/api-keys`, Anthropic `console.anthropic.com/settings/keys`, Gemini `aistudio.google.com/apikey`), `target="_blank" rel="noopener noreferrer"`
4. 모델: 저장된 모델이 없거나 공급자 추천값과 같으면 "추천 모델 사용(…)"을 보여 주고 `직접 입력`(`<details>`)은 접힌다. **저장된 모델이 추천값과 다르면** "사용 중인 모델: <값>(직접 입력)"을 표시하고 직접 입력을 펼친 채 시작한다. 저장 값·API는 그대로
5. 저장·연결 테스트·키 삭제 버튼과 동작은 그대로

## 테스트

- `src/components/layout/__tests__/sidebar-workdeck.test.tsx` 신규: 역할별(MEMBER·ADMIN·OWNER) 설정 그룹 항목, 설정 경로에서 그룹이 펼쳐짐, 위쪽 메뉴 이름
- `src/components/layout/__tests__/sidebar-section.test.tsx` 신규: 비설정 경로에서 마운트 후 설정 경로로 pathname이 바뀌면 그룹이 펼쳐짐
- `src/components/settings/__tests__/members-card.test.tsx` 갱신: OWNER 탭 3개·ADMIN 탭 2개(초대 탭·버튼 없음, 조작 없음), `?tab=invites` 초기 탭, 같은 화면에서 tab 변경 반영, 잘못된 tab 값 → members, 다른 query 보존, 초대 팝업 성공 → 초대 탭 Alert, 다시 보내기·다시 초대 결과(메일 실패 문구·링크 복사)가 Alert에 표시
- `ai-settings-form` 테스트 신규: 사용량 % 표시, 공급자 radio 선택(라벨로 찾기) 시 키 안내 링크가 바뀜, 저장된 사용자 지정 모델이 있으면 그 값이 보이고 직접 입력이 펼쳐짐, 저장 시 그 모델이 그대로 전송됨
- 기존 문구를 검사하는 테스트를 `grep`으로 찾아 갱신(`approval-list.test.tsx`는 화면 안 문구라 영향 없음 확인)

## 검증

- `npm test -- <changed-tests> --runInBand`, `npm run typecheck`, `npx eslint <changed-files>`, `npm run build`
- dev 서버(로컬 QA 로그인)에서 OWNER·MEMBER로 사이드바·팀원·AI 화면 데스크톱/390px 캡처, axe serious·critical 0
- 아이폰 미러링으로 모바일 사이드바 설정 그룹·팀원 탭 확인

## 위험과 롤백

- 위험: 메뉴 이름이 바뀌어 기존 사용자가 메뉴를 못 찾음 → 경로·아이콘은 유지, 설정 그룹은 설정 화면에서 자동 펼침
- 위험: 팀원 화면 이전 중 초대·역할 변경 로직 누락 → 로직은 옮기기만 하고 테스트로 고정
- 롤백: 서버·DB 변경이 없어 develop/main에서 해당 PR revert만으로 되돌린다

## 검토 반영

Codex adversarial-review(2026-11-20) 지적 6건 — 반영 6, 보류 0.

1. [high] 재발송·다시 초대 결과가 닫힌 팝업에 가려짐 → C-7 결과를 초대 탭 Alert 한 곳으로
2. [high] ADMIN에게 OWNER 전용 조작·초대 내역 약속 → C-2 역할별 탭·조작 구분
3. [medium] 탭 URL 초기값만 사용 → C-1 URL 단일 기준 controlled, query 보존
4. [medium] 사용자 지정 모델 오인 → D-4 저장값이 추천값과 다르면 펼쳐서 표시
5. [medium] SidebarSection 경로 변경 시 미펼침 → A-3 활성 전환 시 펼침 + 테스트
6. [medium] 타일 radio 의미·키보드 → D-2 native radio + fieldset
