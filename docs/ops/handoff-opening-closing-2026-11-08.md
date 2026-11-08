# 인계: 오프닝워크 종료 공지 대기 + 토스 계약 대기 (2026-11-08)

이전 세션: Claude Code CLI `549aa036-f0ae-4759-a27d-41b4b1fc10b5`, 작업 디렉터리 `/Users/kaleos/projects/kaleos/workdeck-app-admin`.
응답은 항상 한국어로 쓴다. 결정이 필요하면 AskUserQuestion으로 묻는다.

## 현재 상태: 사용자 응답을 기다리는 중

1. **토스 정기결제 계약** (MID `bill_workdst58`)
   - 심사 중이다. 11/5 토스가 테스트 계정을 요청했고 대응을 마쳤다(#1306·#1309·#1314).
   - 지메일 MCP는 다시 인증해야 해서 메일을 확인하지 못했다.
2. **오프닝 종료 공지일**
   - 사용자가 최종 기한(**11/12 목**)까지 기다렸다가 직접 정한다. 그 전에 게시·배포·발송을 하지 않는다.
   - 계약이 11/11까지 끝나면 B안, 아니면 A안이다.

## 기준 문서 (내용은 여기서 읽는다. 이 문서에 다시 적지 않음)

- 계획·체크리스트: `workdeck-app-admin/docs/ops/2026-10-29-claude-opening-optin-migration-plan-draft.md`. 맨 아래 「2026-11-04」 절들과 「공지일 실행 체크리스트」를 본다.
- 노션 공지 원문
  - A안(종료만): `docs/ops/2026-10-30-opening-closing-notion-notice.md`
  - B안(종료+이전): `docs/ops/2026-11-04-opening-closing-notion-notice-with-migration.md`
- 메모리(`~/.claude/projects/-Users-kaleos-projects-kaleos-workdeck-app/memory/`)
  - `project_opening_migration_decision.md`
  - `project_pg_review_sellable_products.md` (5·6단계, 11-05~06 결정)
- 이 docs/ops 파일들은 **untracked**다. HANDOFF.md와 Codex 인계 문서는 스테이징·커밋하지 않는다.

## 코드 위치 (모두 로컬, 푸시하지 않음)

|                                                                            | A안                                     | B안                                               |
| -------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| opening_web (`~/projects/kaleos/opening-ref/opening_tracking/opening_web`) | `chore/closing-notice` `00c386e`        | `chore/closing-notice-migration` `ab5c9f5`        |
| opening_api (`~/projects/kaleos/opening-ref/opening_api`)                  | `chore/service-closing-block` `be54a87` | `chore/service-closing-block-migration` `fe6bd9b` |

- opening_web 빌드에는 Node 18이 필요하다: `npx -y -p node@18 -p yarn@1 -- sh -c 'yarn install --frozen-lockfile && yarn build'`
- ⚠️ **opening_api·opening_web은 main에 push하는 순간 운영에 배포된다.**

## 공지 당일 순서 (단계마다 승인을 받는다)

1. 사용자가 노션 실페이지를 직접 고친다. 워크덱 노션이라 API로 접근할 수 없다. 고른 버전의 원문을 넣고, 🟡 「11월 2일」을 공지일로 바꾼다.
2. 오프닝 API env `CLOSING_SIGNUP_STOP_DATE`를 공지일로 바꾼다.
3. GitHub Actions 시크릿과 배포 권한을 확인한다.
4. opening_api main을 push하고, 이어서 opening_web main을 push한다.
5. 운영 화면을 ego-browser로 확인한다. 11-07부터 Aside는 쓰지 않는다.
6. welcome.opening.work를 넘긴다: Vercel 도메인을 추가하고 Route53 CNAME을 바꾼다. DNS 변경은 승인이 필요하다.
7. 메일: dry-run으로 대상 수 확인 → 테스트 1통 → 승인 → 발송.

## 날짜가 정해진 작업

- 11/11: prod에 테스트 키로 만든 ACTIVE 구독 1건이 갱신된다. 실제 출금은 없으니 둔다.
- 11/18: StepPay 자동 갱신을 END_OF_PERIOD로 일괄 해지한다. 미룰 수 없고, 승인을 따로 받는다.
- 11/21 이전: Webflow 해지와 Make 끄기. 사용자가 직접 한다.
- 12/1: 그때까지 계약이 없으면 계좌이체 수동 청구(Plan B)를 다시 검토한다.
- 12/18: 오프닝 종료. 비용 정리는 계획 문서 D절을 따른다. RDS 인스턴스는 삭제하지 않고 `opening_prod`만 정리한다.

## 토스 계약이 끝난 뒤 (순서대로)

1. **업무(deck) 단위 체험을 구현한다.** 11/5 사용자 결정이고 아직 착수하지 않았다. 지금 체험은 Space 단위로 평생 1회다.
2. `node scripts/billing-admin.mjs trial-all <YYYY-MM-DD>`로 미리보기를 본 뒤 `--apply`.
3. 라이브 키로 교체한다.
4. env `BILLING_CHECKOUT_PAUSED`와 `BILLING_CHECKOUT_ALLOW_SPACES`를 함께 지우고 다시 배포한다.
5. 테스트 키로 만든 빌링키를 정리한다.
6. B안이면 이전 도구 `feat/opening-import-tools`(푸시 안 함)를 첫 `--apply` 전에 다시 리뷰한다.

## 안전 규칙 (반드시 지킨다)

- 토스 키 전문을 출력하지 않는다. 비교는 앞 14자만 한다. 웹훅 시크릿은 비밀번호처럼 다룬다.
- 아래 작업은 항목마다 명시적 승인을 받는다.
  - 결제·해지·환불
  - DNS 변경, 메일 발송
  - 고객 데이터 적재
  - 서버·DB 종료
- 워크덱 prod DB는 읽기 전용이다. 방법은 node+pg에 `BEGIN READ ONLY`. 스키마 SQL은 실행하지 않는다.
- 오프닝 RDS는 임시 /32 SG 규칙으로만 접근하고, finally에서 철회한 뒤 잔존 규칙이 0인지 확인한다.
- `feat/opening-customer-migration` 브랜치와 `/Users/kaleos/projects/kaleos/workdeck-app` 워크트리는 건드리지 않는다.
- 워크덱 릴리스는 워크트리 → develop → main 순서로 한다. 커밋·PR은 요청이 있을 때만 만든다.

## 추천 스킬

- `ego-browser`: 운영 화면 확인(오프닝 배너·팝업, 워크덱 결제 화면)
- `superpowers:brainstorming` → `superpowers:writing-plans`: 업무 단위 체험 설계
- `superpowers:test-driven-development`: 체험·권한(entitlement) 로직 변경
- `code-review` / `codex:review`: 이전 도구 재리뷰, 배포 전 리뷰
- `superpowers:verification-before-completion`: 배포·발송 전 확인
- `handoff`: 다음 인계

## 첫 행동

`git status`와 `git worktree list`로 상태를 확인한다. 그다음 사용자에게 두 가지를 묻는다: 토스 계약 상태, 공지일·버전.

## 추가 (2026-11-08, kaleos-ax-project 세션)

- 「푸시하지 않았다」는 일부 틀림: 11-04 백업 목적으로 기능 브랜치 2개를 origin에 push했다(main 아님, 배포 없음).
  - `opening_api` origin `chore/service-closing-block` = `fe6bd9b`(B안 시점). 로컬 같은 이름 브랜치는 A안 `be54a87`(fe6bd9b 위 1커밋).
  - `opening_web` origin `chore/closing-notice` = `ab5c9f5`(B안 시점). 로컬 같은 이름 브랜치는 A안 `00c386e`(ab5c9f5 위 1커밋).
  - `*-migration` 브랜치는 push하지 않았다. 원격 브랜치 이름이 A안 이름과 같아도 내용은 B안이니 혼동 주의.
- 작업 문서(`docs/ops/2026-10-2*~11-04*`, `docs/ops/assets/`)는 workdeck-app-admin(detached HEAD)에 미추적 상태로만 있다.
