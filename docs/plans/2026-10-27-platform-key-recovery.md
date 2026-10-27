# 운영자 복구 키 관리 구현 계획

목표: 승인된 Workdeck 운영자 관리 + Supabase Vault 설계를 구현한다. 일반 고객 비밀값/agent ENV 발급 경로를 재사용해 root key를 유통하지 않는다.

기준: origin/main 00cbd24c. 기존 이전 브랜치와 운영 데이터는 유지한다. 의존성·Prisma schema 변경 없이 설치된 Vault와 AdminAuditLog를 사용한다. 기본 UI는 기존 admin account/card 패턴을 따른다(DESIGN.md는 현재 저장소에 없음).

## 설계와 제한

- 이번 대상은 ENCRYPTION_KEY_V1의 k1 root key 한 개다. 현재 운영은 이 키를 사용하며 목적별 키/다른 kid의 백업 완료를 주장하지 않는다.
- Vault 이름은 `workdeck.platform.encryption-v1.k1`로 고정한다. 요청으로 이름·키·복구 목적지를 받지 않는다.
- GET은 보관 metadata와 같은 Vault ID의 마지막 성공 검증 시각만 반환한다. 키·IV·암호문·fingerprint는 반환하지 않는다.
- POST backup/verify는 OPERATOR + 실제 MFA + same-origin이 필수다. 비상 MFA 해제도 허용하지 않는다. body는 action 하나뿐이며 키를 받지 않는다.
- 같은 PostgreSQL transaction에서 감사 시작 → Vault 처리 → 성공 감사 순으로 처리한다. 감사 실패는 transaction rollback, 예외 응답은 고정 코드다.
- 첫 backup만 생성한다. 기존 사본이 다르면 409이고 교체/삭제하지 않는다. 같은 키면 재검증하며 원본은 보존한다.
- verify는 저장 키와 runtime 키를 일정 시간 비교하고, runtime 키로 만든 합성 AES-GCM canary를 저장 키로 복호화해 동일성을 확인한다. 고객 원문은 사용하지 않는다.
- 이 검증은 운영 키와 사본의 일치 확인이다. Vercel 없이 새 환경에서 실제 복구한 시험은 별도로 수행해야 한다.
- 운영자 화면은 key ID/보관 여부/최근 검증/현재 키 사용 가능 여부와 보관·검증 버튼만 제공한다. 평문 보기/복사/내보내기 버튼은 없다.
- Supabase 비상 관리 경로는 Workdeck 로그인과 Vercel 키가 없어도 수행할 수 있도록 문서화한다. Vault root key와 backup snapshot의 복구 조건, Supabase 동시 유실 한계를 명시한다.

## 실행

- [x] 기존 admin/MFA/crypto 기준선 확인(59 tests).
- [x] `src/lib/admin/__tests__/recovery-key.test.ts`: 미보관 metadata, 최초 등록, 멱등성, 다른 키 덮어쓰기 차단, 감사 실패 rollback, 복호화 오류 원문 차단의 실패 테스트 작성/실행.
- [x] `src/lib/admin/recovery-key.ts`: 위 계약을 기존 Prisma transaction·Vault 함수·node:crypto로 구현. 실패 테스트를 통과시킨다.
- [x] `app/api/admin/recovery-key/__tests__/route.test.ts`: 미인증/일반 사용자/실제 MFA 없음/다른 Origin/임의 body 거부·no-store·키 비노출 검사 후 route 구현.
- [x] `src/components/admin/__tests__/recovery-key-settings.test.tsx`: 상태·버튼·확인·오류·검증 시각·키 비노출 검사 후 component, `app/admin/recovery/page.tsx`, admin nav 구현.
- [x] `docs/ops/platform-key-recovery.md`: 등록/검증/실패/비상 복구/보존 조건 작성.
- [x] 관련 92 tests·typecheck·lint 통과, 개발 Vault 합성 rollback 1 test, 실제 MFA browser desktop/mobile 검수, webpack build 통과. 기본 Turbopack은 실행 환경 내부 포트 제한으로 미검증.
- [x] diff/보안 검토와 로컬 commit. 사용자에게 구체적인 운영 배포·최초 등록 대상/영향 제시. 원격 push·운영 배포·최초 키 등록은 이 로컬 구현 단계에서 수행하지 않는다.

## 보안 검토 반영

- 공용 Prisma client의 인증서 검증 비활성화를 root key 경로에서 상속하지 않는다. `src/lib/admin/recovery-db.ts`가 별도 client와 `RECOVERY_DB_CA_CERT`를 요구한다. 검증한 host/port/user/password/database만 직접 전달해 URL query override를 배제한다.
- 원래 SQL/parameter 로그가 켜진 상태에서는 Vault key query를 실행하지 않는다. 안전 조건과 transaction-local 오류 parameter 차단을 검사하며 전역 설정은 변경하지 않는다.
- 개발 Vault 합성 e2e와 실제 운영자/TOTP 브라우저 보관·검증을 통과했다. QA 사본·계정·감사 행·서버는 정리했다. 배포/최초 운영 등록과 실제 재해 복원은 별도다.
