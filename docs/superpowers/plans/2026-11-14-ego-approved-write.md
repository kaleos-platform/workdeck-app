# Ego Cafe24 개발 스킨 승인 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 에이엠엘 Cafe24 개발 스킨의 HTML 주석 저장·재조회·원복을 사람이 검토한 Workdeck 승인과 연결한다.

**Architecture:** 기존 AgentPendingAction 승인·웹 전문 검토와 Space WorkerToken을 재사용한다. 승인 실행은 별도 BrowserWriteJob을 생성하는 것으로 끝나며 외부 저장 성공을 의미하지 않는다. 호스트는 고정 템플릿만 실행하며 대상·원본 해시·비대표 디자인 여부를 재확인한다. claim 후 중단된 작업은 재실행하지 않고 검토 대상으로 남긴다.

**Tech Stack:** Next.js, Prisma/PostgreSQL, Zod, Python 표준 라이브러리, Paseo GPT Terra/low, Ego.

## 승인할 범위

- 등록된 Cafe24 접속 신원, mall/shop, 개발 skin_no/skin_code, `/index.html` 하나를 고정한다.
- 사전 조회에서 실제 비대표 디자인과 원본 SHA-256을 확인한다. 파일 내용·쿠키·고객 데이터는 서버 승인 요청에 넣지 않는다.
- 변경은 `\n<!-- workdeck-ego-check:<markerId> -->\n` 추가 후 동일 세션에서 원문 복원이다. HTML 주석에 임의 문자열·스크립트는 받지 않는다.
- 원본 백업을 먼저 로컬에 저장한다. 저장 전 원본 해시, 복원 전 변경본 해시를 각각 비교한다. 저장 응답 유실·해시 불일치에는 추가 저장하지 않는다.
- 이 해시 검사는 Cafe24 서버의 원자적 CAS가 아니다. 기존 로컬 배포와는 같은 대상 flock을 공유하지만 사람·다른 외부 편집자는 잠그지 못한다. 검증 중 다른 편집을 중지하는 조건을 승인 전문에 표시한다. 서버의 조건부 저장 지원을 확인하기 전에는 무경쟁 보장을 주장하지 않는다.
- 실제 대상과 diff를 사용자에게 제시한 뒤 Workdeck 웹 단건 승인을 받는다. 기존 대화의 구현 진행 승인을 운영 저장 승인으로 취급하지 않는다.

## Task 1: 읽기 전용 사전 조회

- [x] skills 저장소의 `tests/test_paseo_ego.py`에 등록되지 않은 디자인·URL·파일 거부 테스트를 먼저 추가하고 실패 확인.
- [x] `portable/automation/paseo-ego/scripts/paseo_ego.py`에 `cafe24-dev-preflight` 검증과 신뢰된 호스트 설정 해석 추가.
- [x] 고정 worker 절차에 inventory 비대표 확인과 editor 원문 읽기·해시 산출 추가. 저장·입력은 금지.
- [x] 기존 실행기 테스트와 GPT→Ego 실제 접속 시도. `login_required`, Space 166 정리 완료.
- [ ] 재로그인 후 실제 개발 스킨 비대표 여부와 원본 해시 확인.

## Task 2: 서버 승인과 작업 기록

- [x] `src/lib/browser/__tests__/approved-write.test.ts`에서 입력 경계·원본 해시·보고 상태 검증을 먼저 작성하고 실패 확인.
- [x] `src/lib/browser/approved-write.ts`에 고정 params/report schema와 enqueue/claim/report 구현.
- [x] `prisma/schema.prisma`에 BrowserWriteJob과 Space 관계 추가. actionId unique, 상태·Space 인덱스, claim token 소유권, 실행 만료, 결과 기록.
- [x] 격리된 로컬 PostgreSQL에서 `prisma migrate dev --name ego_browser_write_job`으로 migration 생성·검증. 운영 데이터 접근 없음.
- [x] `src/lib/agent/actions/browser.ts` 및 registry에 ADMIN·웹 단건 승인 전용 액션 등록.
- [x] `src/lib/agent/tools/browser-tools.ts` 및 tools/index에 browser:write 제안 도구 등록. 즉시 저장 없음.
- [x] `/api/browser/write-jobs/claim`, `/api/browser/write-jobs/[id]/report`는 Space WorkerToken만 허용. 레거시 전역 키·세션은 거부. claim CAS와 보고 소유권 검증.

## Task 3: 호스트 실행 연결

- [x] Python 테스트에서 미승인·만료·다른 Space·다른 대상·중복 실행 거부를 먼저 확인.
- [x] 호스트 전용 claim bridge를 기존 서비스에 연결하되 설정이 없으면 비활성. 토큰은 호스트 비밀 파일에서만 읽는다.
- [x] GPT worker는 승인된 marker roundtrip만 실행. 기록된 claim 재실행 금지. 원본/변경본/복원본 SHA와 TaskSpace 정리 증거를 서버에 보고.
- [x] 코드 리뷰, 관련 테스트, typecheck, lint, migration 검증.
- [ ] 서버·호스트 기능 배포 후 구체적 승인 링크·diff 제공 및 승인된 실제 roundtrip 검증.

## 완료 기준

사전 조회와 서버/호스트 검증을 구분하여 보고한다. 승인 대기·실제 저장·read-back·복원 완료는 서로 다른 상태다. 승인되지 않은 실제 저장은 실행하지 않는다. Terra/low 기본값은 유지하며 취소된 Luna 비교를 성능 데이터로 사용하지 않는다.
