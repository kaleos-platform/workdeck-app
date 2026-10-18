# 운영 키를 사용하는 이전 원장 검사

Sensitive 키를 내려받지 않고 기존 운영 Function에서 공고·지원서·매장 원장의 복호화·sourceHash를 검사한다. 대상 데이터와 Storage를 변경하지 않는다.

## 구현 계약

- `POST /api/worker/hiring-migration-audit`, 최신 `authenticateWorker`·`workerOwns` 재사용. 공간 토큰은 해당 공간만, 레거시 키는 기존 전환 플래그가 켜진 경우에만 허용한다. 인증의 사용 시각 갱신도 끄며 cron 등록·실행 이력 쓰기는 없다.
- 대상 customer enum은 `ameaning`, `peakpay`만 허용한다. 서버에서 이미 승인된 대상 계정으로 대응하고 단일 OWNER 멤버십을 재확인한다. 입력 spaceId·이메일·임의 고객 지정은 거부한다.
- READ ONLY transaction에서 첫 공고 원장의 sourceSpaceId·범위를 복구 검증해 기준으로 삼고, 같은 고객 원장만 id 순으로 25개씩 검사한다.
- 첫 요청에 읽은 마지막 원장 ID를 through로 고정한다. 이후 after/through 페이지를 순차 조회한다. 완료를 판단하려면 모든 페이지의 checked 합계를 total과 대조해야 한다.
- 공고·지원서는 기존 복구 함수를 사용한다. 매장은 sourceHash 무결성만 확인하며 공고·지원서 입력 schema 검증으로 표현하지 않는다.
- 원장/target ID·source ID·키·원문은 응답하지 않는다. 불투명한 페이지 경계 ID와 모델별 검사 집계만 반환한다. Cache-Control은 private, no-store.
- 오류는 고정 코드만 반환하고 원본 예외를 로그에 출력하지 않는다. 무인증·잘못된 입력은 DB 접근 전에 거부한다.

## 검증과 한계

합성 암호문으로 정상·손상·다른 고객·원본 ID 불일치 및 응답 원문 비노출을 검증한다. 실제 운영 검증은 배포 후 기존 서버 인증으로 호출하며, 임시 인증 파일은 삭제한다.

이 경로는 원장 복구 검사다. 현재 대상 hash와 원본 DB 범위는 별도 검증 결과를 사용하며 이미지 원본 manifest·실제 bytes 대조는 후속 범위다. 실제 고객 알림·재적재·수정·삭제·서비스 전환은 포함하지 않는다.

## 운영 호출

승인된 기존 서버 인증 설정을 접근 제한된 환경 파일에 준비한 뒤 호출한다. 복호화 키는 로컬 파일에 필요하지 않다. CLI는 목적지를 `https://app.workdeck.work`로 고정하고 redirect를 거부한다. 환경 파일을 shell에서 source하거나 인증값을 명령 인수에 넣지 않는다.

```sh
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer ameaning
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer peakpay
```

CLI는 같은 through를 유지하면서 페이지를 순차 요청하고 마지막 checked 합계가 total과 다르면 실패한다. 반복 cursor·상한 변경·비정상 집계도 거부한다. exit 0은 조회 범위 내 무결성/복구 오류 없음, exit 2는 검토할 실패 건수 있음, exit 1은 호출 또는 완주 검증 실패다. total은 별도 원장 집계와도 비교해야 한다. 페이지마다 별도의 읽기 snapshot이므로 전체 작업 동안 원본·대상 쓰기를 동결했다고 가정하지 않는다.

로컬 검증: 관련 Jest 10 suites/171 tests, CLI 3 tests, TypeScript·전체 lint(오류 0/기존 경고 63)·webpack production build 통과. 실제 운영 결과는 배포 후 별도 기록한다.
