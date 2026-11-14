# 지원자 첨부 정리 전환 초안

이 문서는 단계별 전환 기록과 남은 운영 점검 계획이다. 아래의 읽기 전용 점검은 해당 시점의 상태다.

## 2026-11-14 phase 1 배포

- `f7dfdc961b7df1c27ef7720433e827da4c4fab20` 기준 후보 `ae6bc36a`는 기존 `hiring-upload-sweep` cron 항목만 제거했다. 기존 migration 변경은 없다.
- 2026-11-14 KST에 production deployment `dpl_8DHBLhVPMyaXEyPGyZaJVS6SXnby`가 READY였고 `app.workdeck.work` alias가 이를 가리켰다. 해당 deployment의 cron metadata에서 v1 항목의 제거를 확인했다. CLI 배포 metadata의 Git SHA는 null이므로 SHA로 배포 소스를 독립 확인할 수 없다.
- 스케줄 제거만으로 이전 실행의 종료가 증명되지는 않는다. 실행 drain, 실제 배포 런타임 역할·권한 및 로그 정책 확인은 별도 전제다. phase 2 migration 적용과 새 스케줄 활성화는 아직 하지 않았다.

## 2026-11-14 phase 2·3 배포 및 첫 실행

- phase 2 배포 source `9a99b88d`, production deployment `dpl_5PYKWGY3aV86HVJYayUxm7JXZhFZ`의 READY 및 alias를 확인했다. 운영 DB를 인증서 검증·읽기 전용으로 확인해 cleanup migration 6건 적용과 checksum 일치, API 함수 5건의 runtime 실행 권한과 PUBLIC·anon·authenticated 차단, 필수 trigger 6건과 원장·cursor RLS 활성화를 확인했다.
- 승인된 backfill을 한 번 실행해 현존 세션 5건을 처리했다. `status: ok`, `completion: complete`, 실패·잔여·미확인·격리는 0이고 같은 실행의 CronRun 집계가 일치했다. 이 결과는 과거 삭제 자료나 Storage 정리 완료를 뜻하지 않는다.
- phase 3 배포 source `8f5104fd`, production deployment `dpl_4Z76hPe1tLcN7nPM8ZbVixBDiL3H`의 READY 및 alias를 확인했다. cron metadata에서 cleanup `*/5 * * * *` 등록과 v1·backfill cron 미등록을 확인했다. 두 CLI 배포의 Git SHA metadata는 null이다.
- 첫 예약 cleanup의 CronRun은 `ok: true`, `status: ok`, `completion: pending`이며 referenced, active, quarantined, blocked, deleteCallsSucceeded, failed, due, lag_seconds, quarantined_total, failed_total은 모두 0이었다. 수동 cleanup 호출은 하지 않았다. `pending`은 무기한 재검사의 정상 상태이며 이후 실행 누락과 격리·실패 증가를 계속 감시해야 한다.

## 2026-11-14 읽기 전용 점검

- 기존 문서의 프로젝트 허용목록과 로컬 운영 환경 파일의 대상을 대조하고, 신뢰된 CA와 `rejectUnauthorized: true`, `BEGIN READ ONLY` 및 statement timeout을 사용했다. 정리 함수나 cron route는 호출하지 않았다. 이 로컬 운영 파일이 현재 배포 환경과 같다는 것은 별도 확인이 필요하다.
- 정리 원장·cursor·claim 함수는 미설치였다. 따라서 새 함수의 실제 실행 권한은 아직 판정할 수 없다.
- 현존 업로드 세션 5개 중 Space ID가 CUID 형식이 아닌 세션은 4개이며, 그중 파일이 있는 세션은 1개, 완료된 세션은 4개였다. CUID 형식이 아닌 Space의 공고는 7개, ACTIVE는 3개였다. 식별자·경로·고객 정보 원문을 조회하거나 기록하지 않았다. 이 집계는 현재 세션 표본이며 고객 전체 비율이 아니다.
- 현재 strict CUID 검증은 해당 Space의 신규 파일 업로드와 기존 참조를 차단할 수 있다. 실제 호환성 차단 사유이므로 이 상태로 운영 통합하지 않는다. 단순 형식 완화는 경로에 포함된 식별자의 개인정보 부재를 입증하지 않는다.
- 로컬 운영 환경 파일에는 `CRON_SECRET`이 없었다. 배포 환경의 설정 부재를 뜻하지 않으며, 배포 런타임에서 별도 확인해야 한다.

- 기존 v1 cron은 Storage 삭제 후 DB가 rollback될 수 있다. DB fence 설치 전 이미 진행된 실행과 과거 고아 파일은 복구하지 못한다. 전환 전에 v1 스케줄을 중지하고 진행 중인 실행의 종료를 확인해야 한다. 배포가 겹치는 동안 구버전 route를 수동 호출하지 않도록 운영 경로도 확인한다.
- 1·2·3단계를 함께 검토한다. migration의 session claim fence, 파일 참조 guard, retired 선확정과 새 cleanup 함수가 정상 적용됐는지 확인하고 기존 세션 backfill 결과를 확인하기 전 새 정리 스케줄을 켜지 않는다. 기존 v1 CronRun의 `deleted` 의미는 바꾸지 않는다.
- 신규 backfill·cleanup route의 함수 한도는 60초로 설정했지만, `vercel.json`의 cron 스케줄에는 등록하지 않았다. 배포 승인 전에 별도 경로의 스케줄을 결정하고 `CRON_SECRET`, 실제 Prisma 연결 역할의 함수 EXECUTE와 DB 권한, RLS를 읽기 전용으로 확인해야 한다. 합성 service role 시험은 실제 프로젝트 권한을 증명하지 않는다.
- `completion: pending`은 무기한 재검사를 나타낸다. backfill의 `complete`는 현존 세션의 처리 집계일 뿐 과거 삭제 자료나 Storage 정리 완료가 아니다. cleanup의 `deleteCallsSucceeded`는 Storage 삭제 호출 성공 횟수이며 객체가 실제로 존재했거나 완전히 삭제됐다는 증명은 아니다.
- 운영에서 최근 cron 실행 누락, `CronRun` 기록 실패, `due`, `lag_seconds`, 격리 기록, `failed_total`, 부분 실패와 미확인 통계를 감시한다. 통계 조회 실패는 0이 아니다. quarantine marker에는 세션 변경·삭제 사건이 중복 기록될 수 있어 고유 세션 수로 해석하지 않는다. OLD/NEW의 유효 경로 합집합이 3개를 초과하면 자동 정리 대신 격리된다.
- cleanup 실행에서 quarantine이 발생해도 다른 처리에 실패하지 않았다면 `CronRun.ok`는 true일 수 있다. 따라서 `ok`만 보지 않고 실행별 `quarantined`와 `quarantined_total`의 증가를 별도로 감시한다.
- Space ID가 ASCII 영숫자·`_`·`-`로 이뤄진 비어 있지 않은 단일 segment이면 CUID가 아니어도 기존 경로를 그대로 보존한다. session UUID와 file UUID·허용 확장자, 정확한 Space 소속과 전체 경로를 함께 확인한다. 경로가 모호하거나 확인되지 않는 자료, UUID형 legacy 및 외부 writer는 차단되거나 격리될 수 있다. 익명 role의 함수 접근 차단과 운영 DB 로그·statement/parameter logging 정책도 배포 전 확인한다.
- 전용 Storage 요청의 3초 abort는 서버 측 처리 취소를 보장하지 않는다. 응답 유실이나 늦은 완료가 발생해도 은퇴 상태와 경로 원장을 유지하고 반복 정리한다. 원장은 무기한 보존하므로 데이터 증가와 검사 지연에 대한 용량 계획이 필요하다.
- 완료 claim과 정리 대상 판정은 session 행 잠금 아래 DB 시계를 기준으로 한다. 앱에서 완료 claim을 시작했더라도 파일 연결 전에 DB 만료 경계를 넘으면 제출이 rollback되어 기존 오류 응답을 받을 수 있다. 오래된 앱이나 외부 writer의 호환성은 실제 배포 전 별도 확인해야 한다.
- 잠긴 후보의 session lock은 후보별 subtransaction을 되돌려 해제한다. 한 호출에 50개 후보까지 건너뛴 뒤 `skipped_limit`으로 중단하지만 다음 호출은 DB에 보존한 기존 정렬 위치 다음부터 탐색하고 끝에서 처음으로 순환한다. 잠긴 행은 완료 표시하지 않는다. cursor lock을 얻지 못하면 `blocked`로 종료한다. `blocked`, `due`, `lag_seconds`와 최근 실패를 함께 감시하고 장시간 지속되면 운영자가 원인을 확인해야 한다.

## 최종 운영 상태 재확인

앞선 미등록·미검증 문구는 전환 준비 당시의 이력이다. 최종 운영 deployment `dpl_4Z76hPe1tLcN7nPM8ZbVixBDiL3H`는 production READY이고 `meta.gitCommitSha`가 배포 소스 `8f5104fda9f9293bd64d8a89b91f93772a83219a`와 일치함을 주 agent와 독립 검토가 확인했다. `githubCommitSha` 필드 부재를 전체 Git SHA 부재로 해석한 앞선 관측을 정정한다.

최종 운영에는 cleanup `*/5 * * * *`만 등록됐고 v1 및 backfill cron은 없다. 신규 migration 6개와 권한·trigger·RLS를 실제 production 환경에서 확인했으며 backfill은 세션 5개 처리 후 실패·잔여·미확인·격리 0으로 완료했다. 첫 예약 실행은 정상으로 기록됐고 삭제 호출은 0이었다. 따라서 실제 고객 파일을 삭제해 본 검증은 아니며, 운영 전체 Storage에 고아 파일이 없음을 의미하지 않는다. 이후 실행 누락·격리·실패·대기량 증가는 계속 관측해야 한다.
