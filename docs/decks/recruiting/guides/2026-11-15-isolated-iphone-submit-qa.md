# iPhone 격리 합성 접수 검증 — 2026-11-15

> 이 문서는 격리 환경에서 수행한 당시 시험 기록이다. 이후 사용자 승인하에 운영 iPhone 접수·관리자 다운로드·20MiB 경계·다중 첨부를 추가 검증했다. 최신 결과와 남은 범위는 [운영 iPhone 검증 기록](2026-11-15-production-iphone-qa.md)을 따른다.


## 범위와 발송 차단

사용자의 실제 iPhone 접수 검증 요청에 따라 수행했다. 운영 QA 공고는 notificationEnabled=false지만 접수 메일이 기본 활성이고 이메일도 필수이며 지원서 삭제 API가 없어, 운영 제출은 진행하지 않았다. 현재 source·운영 관측 `2ce32835`를 기준으로 별도 worktree와 로컬 PostgreSQL 및 지정 개발 Storage(tumkfkfgzkmisguyaghn)의 private hiring-files를 조합했다. 운영 DB와 공유 개발 DB에 시험 데이터를 쓰지 않았다.

합성 공고의 notificationEnabled·applicantReceiptEmail·dailyDigestEmail은 모두 false이고, 실제 Next 프로세스에서 발송 비밀 미주입을 확인했다. 운영 암호키를 복사하지 않고 합성 V1/HMAC 키를 사용했다. LAN HTTP의 next dev이므로 운영 HTTPS·Secure cookie·서버리스 환경과 동등하다고 주장하지 않는다.

## 실제 iPhone 흐름

기존 미러링 창의 네이티브 클릭·키보드와 iOS 파일 선택기로 합성 이름·전화·이메일 및 기기에 이미 있던 workdeck-qa-sample.pdf(593B)를 입력했다. 개인 파일을 탐색하거나 카메라·사진 보관함을 사용하지 않았다. 선택항목은 비워 두고 동의는 이 합성 접수에만 체크했다.

첫 시도는 prepare 201·recover 200·complete 409였다. 개발 Storage에 파일은 존재했지만 로컬 지원서/첨부 행은 0이었다. 추가 버튼을 무작정 반복하지 않고 격리 route에 원문 없는 stage/name/code 분류만 계측했다. before_pii·after_pii 뒤 conflict임을 확인했다.

## 시간대 원인과 재시험

로컬 initdb의 timezone이 Asia/Seoul로 생성됐고, Prisma UTC timestamp인 expiresAt과 clock_timestamp()의 암묵 비교가 아직 유효한 session을 만료로 판정했다. 기존 완료 claim guard가 updateMany count 0을 반환한 것과 부합했다. 합성 암호화는 실제 요청에서 통과했으므로 암호키 오류가 아니었다.

검증용 PostgreSQL만 UTC로 맞춘 후 실제 Next 연결에서 UTC=true·active 비교 false→true, session/ledger checksum 불변을 확인했다. 제품 함수·운영 DB는 수정하지 않았다. 운영에서 관측한 UTC 전제를 로컬도 맞춘 것으로, 비UTC 연결에 같은 SQL을 적용할 때의 시간대 의존성을 무조건 안전하다고 주장하지 않는다.

HMR 후 iPhone 복구 확인은 기존 미완료 session을 취소하고 폼으로 복귀했다. 이후 네이티브 제출 한 번으로 prepare 201·recover 200·complete 201 및 ‘지원이 완료되었습니다’ 화면을 확인했다. 최종 로컬 DB는 지원서 1·파일 1·완료 session 1이며 전체 session/원장은 취소 시도를 포함해 각각 2건이었다.

## 파일 검증과 정리

서버 측 개발 Storage readback에서 두 시도의 파일이 각각 593B·application/pdf이고 SHA-256이 서로 같음을 확인했다. 완료 file record의 경로·크기·MIME도 일치했다. iPhone 원본의 별도 digest 대조나 관리자 인증 다운로드를 수행한 것은 아니다. iPhone 직접 PUT의 HTTP 응답 status는 Next 로그로 독립 수집하지 않았으며 객체 존재와 완료 API의 metadata 검사로 연결을 확인했다.

정확한 합성 경로 2개만 삭제한 뒤 info의 statusCode=404와 각각의 exact filename list 부재를 확인했다. SDK의 status=400 안에 statusCode=404인 응답을 처음에 부재로 해석하지 못했으나 확인 스크립트를 정정해 교차 확인했다. 제품 정책 결함으로 기록하지 않는다. 와일드 삭제나 다른 객체 변경은 없었다.

소유 Next/PG를 종료하고 포트 58493·58249의 LISTEN 없음, 임시 환경 디렉터리 부재, 진단 코드 원복·worktree clean을 확인했다. 원래 iPhone PDF는 그대로다. 성공 확인 뒤 미러링 창이 조회되지 않아 추가 기기 조작을 중단했으며, 이번 실행 후 로그인 화면 복원은 확인하지 못했다.

## 만료 후 재검사

서명 URL이 남아 있으므로 즉시 부재와 미래 고아 부재를 구분한다. 토큰 없는 두 경로만 ~/.codex/qa/workdeck-ios-e2e-20261115-XoG3aH/paths.json(상위0700/파일0600)에 보존했다. 재검사 최소 시각은 2026-11-14 18:55:52 UTC이다.

Paseo schedule ceb7d960으로 2026-11-15 04:00 KST(19:00 UTC) 한 번의 후속 검사를 등록했다. maxRuns=1·6시간 만료이며 지정 개발 버킷의 두 경로만 읽고, 같은 합성 경로에 늦게 도착한 객체가 있을 때만 삭제·부재 확인한다. 운영 DB/Storage·발송·기기 조작·새 지원서·PR/배포는 금지한다. 예약 등록은 실행 완료가 아니며 결과를 확인하기 전 만료 후 정리를 완료로 표시하지 않는다.

## 당시 남은 경계

관리자 로그인·native 관리자 다운로드, 운영 제출, 최대20MiB·다중파일·사진·카메라·다른 파일 제공자 및 운영 HTTPS 조건은 별도 미검증이다. 이번에는 합성 실기기 접수와 개발 Storage 왕복을 확인했으며 전체 고객/미래 장애 복구를 보장하지 않는다. 로컬 캡처는 gitignore 대상 screenshot/2026-11-15-isolated-ios-*.png에 두었다.

## 만료 후 재검사 완료

2026-11-15 04:00:53 KST 예약 실행이 성공했다. 합성 첨부 정확한 두 경로 모두 info statusCode 404와 부모 폴더 exact filename 목록 부재를 확인했다. present/deleted/remaining은 0/0/0이며 삭제 요청과 임시 자원 생성 없이 경로 원장에 결과를 기록해 보존했다. 이번 시점의 부재 확인이며 지연 업로드의 영구 부재를 보장하지 않는다.
