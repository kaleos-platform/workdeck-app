# Supabase 인증 메일 템플릿

앱 메일(`src/lib/email/layout.ts`)과 같은 디자인의 Supabase Auth 템플릿이다. 이 폴더의 `*.html`은 생성물이라 직접 고치지 않는다.

- 정의: `src/lib/email/supabase-templates.ts`
- 다시 생성: `UPDATE_EMAIL_TEMPLATES=1 npx jest src/lib/email/__tests__/supabase-templates.test.ts`
- 정의와 파일이 다르면 같은 테스트가 실패한다.

## 대시보드 적용 (운영 변경이라 승인 후)

Supabase 대시보드 → 운영 프로젝트 → Authentication → Emails → Templates에서 템플릿마다 제목과 본문(Source)을 붙여 넣고 저장한다.

| 파일                | 대시보드 템플릿      | 제목                                     |
| ------------------- | -------------------- | ---------------------------------------- |
| `confirmation.html` | Confirm signup       | [Workdeck] 이메일 주소를 확인해 주세요   |
| `invite.html`       | Invite user          | [Workdeck] 워크스페이스에 초대되었습니다 |
| `magic_link.html`   | Magic link           | [Workdeck] 로그인 링크                   |
| `email_change.html` | Change email address | [Workdeck] 이메일 변경 확인              |
| `recovery.html`     | Reset password       | [Workdeck] 비밀번호 재설정               |

- 초대 링크 형식(`/auth/confirm?token_hash=…&type=invite&next={{ .Data.invite_path }}`)은 `src/lib/spaces/invite-email.ts`가 의존한다. 바꾸지 않는다.
- 「1시간 동안 유효」 문구는 Auth 설정 `mailer_otp_exp` 3600초 기준이다. 설정을 바꾸면 정의도 고친다.
- 대시보드에서는 HTML 본문만 설정한다. 앱 메일처럼 plain text 파트를 따로 지정하지 않는다.
- 적용 후 가입·비밀번호 재설정·초대를 실제로 보내 링크가 동작하는지 확인한다.
