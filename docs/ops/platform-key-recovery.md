# 플랫폼 k1 복구 키 사본 운영

대상은 Vercel Production의 `ENCRYPTION_KEY_V1` k1 root key 한 개다. 일반 고객 Space 비밀값/에이전트 ENV 발급과 분리한다. 다른 kid·목적별 전용 키·HMAC 키·Storage 객체 bytes까지 백업한 기능이 아니다.

## 운영 반영 전

1. 배포할 커밋과 현재 production 기준 커밋을 비교한다. 사용자 검토 없이 오래된 이전 브랜치를 production에 덮어쓰지 않는다.
2. 동일 Supabase 프로젝트의 공식 DB CA PEM을 확인해 Vercel Production에 `RECOVERY_DB_CA_CERT`로 설정한다. 비밀키가 아닌 공개 인증서다. `NEXT_PUBLIC_SUPABASE_URL`과 `DATABASE_URL`의 프로젝트 소속이 일치해야 한다.
3. root key 경로는 별도 PrismaPg client를 사용한다. CA/hostname 검증을 강제하고 URL query의 endpoint/인증/SSL override를 전달하지 않는다. CA가 없거나 프로젝트가 다르면 연결하지 않는다.
4. 설치된 Vault의 `create_secret`·`vault.secrets`·`vault.decrypted_secrets` 접근과 AdminAuditLog 쓰기 권한을 확인한다. Vault/감사 schema는 기존 것을 사용하므로 새 Prisma migration은 없다. extension이 없는 환경에 직접 SQL로 임의 생성하지 않는다.
5. parameter가 로그에 남는 설정에서는 실행하지 않는다. 앱이 `log_statement=none|ddl`, duration/sample 로그 꺼짐, `pgaudit.log_parameter=off`를 검사하고 오류 bind 출력은 transaction-local `0`으로 강제한다. 조건 불충족/설정 실패 시 사본을 만들지 않는다. 운영 전체 logging 설정은 이 기능이 변경하지 않는다.
6. 개발 DB/운영 DB를 구분한다. 최초 보관은 별도 운영 반영 검토 후 운영자 UI로만 수행한다. 키를 채팅·Git·CLI 인수·일반 로그에 넣지 않는다.

## 보관·검증

- 운영자 전용 `/admin/recovery`로 이동한다. 플랫폼 OPERATOR 역할과 실제 TOTP MFA가 필요하다. 일반 Space OWNER/ADMIN이나 worker/agent 토큰에는 경로를 제공하지 않는다.
- ‘사본 보관’ 확인창은 현재 runtime 키를 서버에서 읽어 Vault 이름 `workdeck.platform.encryption-v1.k1`에 저장한다. 요청은 action만 받으며 키·이름·목적지를 받지 않는다.
- 기존 사본이 있으면 새로 만들거나 교체하지 않고 일치를 검사한다. 다른 키라면 409로 중단하며 원래 사본을 보존한다. 자동 삭제/덮어쓰기/키 회전은 없다.
- 감사 시작 → 보관/읽기 → 합성 AES-GCM canary 복호화 → 성공 감사가 동일 DB transaction이다. 성공 감사까지 저장하지 못하면 신규 사본도 rollback한다. 키 값·암호문은 응답하지 않는다.
- 상태 화면에는 key ID·보관 여부·최초 보관·마지막 사본 일치 검증 시각만 표시한다. ‘보관됨’은 현재 키와 계속 같음을 보증하지 않으며, 마지막 검증은 그 시점의 결과다.
- 실패 transaction의 시작 감사도 rollback될 수 있다. 성공 이력만으로 모든 실패 시도까지 추적됐다고 주장하지 않는다. 오류는 고정 code/메시지로만 반환한다.

## 장애·충돌

- 상태 조회 실패를 ‘미보관’으로 해석하지 않는다. 연결·CA·Vault 권한·감사 기록 상태를 확인한다.
- POST 응답이 유실되면 먼저 상태를 새로고침한다. 동일 키 재실행은 재검증이며 다른 키를 덮어쓰지 않는다.
- `BACKUP_MISMATCH`면 현재 key ID/환경변수와 사본의 이력을 확인한다. 해결을 위해 임의 삭제·새 키 덮어쓰기·key ID 재사용을 하지 않는다.
- 현재 k1 root key가 없거나 유효한 64자리 hex가 아니면 보관/검증을 차단한다. 보관 사본의 값 보기/복사 endpoint는 없다.

## Vercel 없이 비상 복구

이 절차는 Workdeck 로그인과 현재 Vercel 키에 의존하지 않아야 한다.

1. 별도로 접근 가능한 Supabase 운영자 계정으로 올바른 프로젝트를 확인한다. 해당 계정·MFA 기기의 복구 수단도 별도 보관한다.
2. Supabase Vault 관리 경로에서 정확한 이름 `workdeck.platform.encryption-v1.k1`과 key ID·보관 시점을 확인한다. 일반 agent/고객 계정에 접근 권한을 추가하지 않는다.
3. 승인된 복구 환경/제한된 운영자 세션에서 사본을 Vercel Sensitive 환경변수에 직접 재설정한다. 값은 채팅·Git·스크린샷·명령 인수·일반 로그를 거치지 않는다. Workdeck 앱의 UI/API가 원문을 반환하도록 임시 우회 기능을 만들지 않는다.
4. 준비된 합성 암호문을 복호화해 원래 값과 비교하고, 승인된 고객 원장 읽기 검증을 수행한다. 이 기능의 ‘사본 일치 검증’만으로 새 환경의 전체 DB·파일 복구가 끝났다고 표시하지 않는다.
5. 복구 환경의 원장/DB 시점과 파일 manifest/bytes·접근권한을 확인하고 관찰 후 서비스 재개를 판단한다.

Supabase Vault는 앱의 Vercel 키와 별도의 프로젝트 root key를 사용한다. 공식 physical restore/새 프로젝트 복제와 수동 pg_dump/pg_restore의 root key 이관 조건이 다르다. Vault 테이블만 담은 SQL dump를 다른 프로젝트로 옮기면 자동 복호화될 것이라고 가정하지 않는다. Supabase 프로젝트/계정까지 유실되는 상황에는 독립된 암호화 사본과 해제 수단의 추가 보관이 필요하다.

공식 근거: [Vault](https://supabase.com/docs/guides/database/vault), [새 프로젝트 복원](https://supabase.com/docs/guides/platform/clone-project), [PostgreSQL logging](https://www.postgresql.org/docs/current/runtime-config-logging.html).

## 개발 검증

변경 단위 테스트와 typecheck/lint/build를 실행한다. `src/lib/admin/__tests__/recovery-key.e2e.test.ts`는 별도 Jest e2e 설정으로 실행하며 명시된 개발 project만 허용하고 운영 ref는 거부한다. 합성 Vault 항목 하나를 생성·복호화한 뒤 전체 transaction을 rollback하고 잔여 0건을 확인한다. 실제 운영 키 사본 등록 시험이 아니다.
