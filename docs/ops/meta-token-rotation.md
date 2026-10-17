# Meta 광고 토큰 교체 런북

Space 의 Meta 광고 연동(`SpaceCredential`, provider `meta-ads`)은 Meta 앱의 access token 과 app secret 을
암호화해 한 곳에 둔다. 에이전트(MCP)·일일 보고·승인 실행이 모두 이 값을 쓰므로, 토큰이 만료·폐기되면
조회·제안·실행이 함께 멈춘다.

## 장애 감지

- 매일 08:00 KST cron `/api/cron/credential-health` 가 Space 마다 광고 계정 조회(통화)로 토큰을 점검한다.
- 정상 → 오류로 바뀌면 그 Space 의 Slack **notifications** 채널에 한 번 알리고 `lastError` 에 남긴다.
  오류가 이어지는 동안은 다시 알리지 않고, 복구되면 "복구되었습니다" 를 한 번 알린다.
- 실행·검증 경로의 Graph 오류도 `lastError` 에 남는다(제안 단계 validate_only 오류는 남기지 않는다).
- workdeck 자체가 내려가면 이 cron 도 돌지 않는다. 그때는 에이전트의 일일 스크립트가 "조회 실패" 로 보고한다.

## 교체 절차

1. **새 토큰 발급(Meta).** 비즈니스 설정의 시스템 사용자 토큰(만료 없음 또는 60일)을 권장한다.
   권한은 `ads_read`, `ads_management`, `business_management` 만 준다. 대상 광고 계정을 시스템 사용자에 할당한다.
   토큰 평문은 채팅·티켓·커밋에 붙이지 않는다.
2. **현재 config 확인.** 교체는 비밀값과 config 를 함께 보낸다(PUT 은 전체 교체). 현재 브랜드→광고 계정 매핑
   (`adAccounts`)과 `defaultBrand` 를 그대로 다시 넣는다. config 에는 비밀값이 없다.
3. **workdeck 에 저장.** 해당 Space 의 ADMIN 이상 계정으로 로그인하고 2단계 인증을 마친 브라우저에서,
   `https://app.workdeck.work` 탭의 개발자 콘솔로 보낸다(평문이 셸 기록에 남지 않게).

   ```js
   await fetch('/api/spaces/<spaceId>/credentials/meta-ads', {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       secret: { accessToken: prompt('새 토큰'), appSecret: prompt('앱 시크릿') },
       config: { defaultBrand: '<brand>', adAccounts: { '<brand>': 'act_<id>' } },
     }),
   }).then((r) => r.status)
   ```

   - 저장 전에 서버가 매핑된 광고 계정의 통화를 Graph 로 확인한다. 실패하면 저장하지 않는다(옛 토큰 그대로).
   - 성공(200)하면 `lastError` 가 비워진다.

4. **확인.** MCP `meta_ads_list_campaigns`(조회)와 `meta_ads_list_actions`(승인 큐)를 한 번 부른다.
   다음 날 08:00 점검에서 알림이 없거나 "복구" 알림이 오면 끝이다.
5. **옛 토큰 폐기(Meta).** 새 토큰으로 조회가 되는 것을 확인한 뒤 Meta 에서 옛 토큰을 폐기한다.

## 하지 않는 것

- 토큰을 에이전트 `.env`·스크립트에 두지 않는다(2026-10-14 이후 workdeck 한 곳).
- DB 에 직접 쓰지 않는다(암호화 형식은 서버가 정한다).
