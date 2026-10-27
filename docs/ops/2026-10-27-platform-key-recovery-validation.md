# 복구 키 관리 구현 검증 — 2026-10-27

브랜치: feat/platform-key-recovery. 기준 커밋: 00cbd24c(origin/main). 사용자 승인한 Workdeck 운영자 관리 + Supabase Vault 방식의 로컬 구현 결과다. 운영 키 사본 등록·새 환경 복원은 아직 실행하지 않았다.

## 구현

- `/admin/recovery`: 운영자 전용 metadata·최초 사본 보관 확인·사본 일치 검증. 값 보기/복사/agent 발급 기능 없음.
- `/api/admin/recovery-key`: OPERATOR·실제 MFA·same-origin·고정 action만 허용. no-store·고정 오류·기존 사본 충돌 시 덮어쓰기 차단.
- Vault와 성공 감사는 같은 transaction. 다른 사본이나 감사 실패면 신규 저장도 rollback.
- 별도 strict PrismaPg client: CA/hostname 검증, URL query의 host/user/password/SSL override 차단, SQL parameter logging 안전 조건 검사.
- `RECOVERY_DB_CA_CERT` 공개 CA 설정 필요. 의존성·Prisma schema·공용 DB client 변경 없음.
- [운영·비상 복구 절차](platform-key-recovery.md) 참조.

## 검증 결과

| 항목                                       | 결과                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 신규 보관/보안/route/UI 테스트             | 4 suites / 33 tests 통과                                                                                                  |
| 기존 admin/MFA/field-crypto 포함 관련 검사 | 7 suites / 92 tests 통과                                                                                                  |
| 개발 Vault 실제 합성 저장·복호화·rollback  | 1 test 통과·잔여 0                                                                                                        |
| TypeScript                                 | 통과                                                                                                                      |
| 전체 ESLint                                | 오류 0·기존 경고 68, 변경 파일 신규 경고 없음                                                                             |
| webpack production build                   | 개발 프로젝트 공개 URL/anon key 두 개만 제공해 통과, 369개 static page 생성                                               |
| 기본 Turbopack build                       | symlink 제약 해소 후에도 내부 worker 포트 binding이 실행 환경에서 차단됨. 통과로 표시하지 않음. 기본 설정은 변경하지 않음 |
| 보안 코드 리뷰                             | TLS 검증과 연결 URL query override 지적 수정·재검토에서 추가 blocker 없음                                                 |

## 실제 브라우저 QA

개발 프로젝트만 허용한 임시 QA 계정에 운영자 역할을 부여하고 Supabase의 실제 TOTP를 등록·검증했다. MFA 비상 해제를 사용하지 않았다. 로컬 UI에서 보관 버튼 1회와 별도 검증 버튼 1회 성공 HTTP 응답을 기다려 확인했다. 감사 결과는 backup.started 1, verify.started 1, verify 2다. 사용한 k1 값은 시험 프로세스에서 생성한 합성 키이며 운영 키가 아니다.

1440px desktop·390px mobile에서 가로 넘침 0이며 스크린샷을 직접 확인했다. 이미지 경로는 `/private/tmp/workdeck-recovery-desktop.png`, `/private/tmp/workdeck-recovery-mobile.png`다. 이는 로컬 개발 화면이며 운영 보관 성공 근거로 사용하지 않는다.

시험 후 해당 QA 계정·감사 행·합성 사본을 정확한 사용자/항목 ID로 정리했다. Vault 잔여 0, auth 계정 삭제 완료, 로컬 QA 서버 포트 3127 listener 0을 확인했다. 기존 개발 자료·운영 계정·운영 키를 변경하지 않았다.

## 운영 반영 단계

1. 코드 반영 시 production 최신 기준과 비교하고 원격 코드 배포 범위를 확인한다. 현재 로컬 커밋 단계다.
2. 운영 `RECOVERY_DB_CA_CERT`에 검증한 공개 CA를 설정하고 실제 배포 빌드/접근 경계를 확인한다.
3. 맥 미니 Aside u2의 `https://admin.workdeck.work/admin` 확인 시 관리자 도메인은 로그인 화면이었다. 실제 OPERATOR 계정으로 로그인·MFA 후 새 화면에서 최초 사본 보관/검증을 수행해야 한다. 임의 운영자 승격·MFA 우회는 하지 않는다.
4. 실제 등록 후에도 Supabase 별도 관리 접근·독립 복원 시험·파일 bytes 백업·고객 최종 전환 대조는 별도로 남는다.
