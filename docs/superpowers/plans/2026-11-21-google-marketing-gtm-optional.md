# 구글 마케팅 자격증명 — GTM 선택 항목화

## 목표

Kaleos 공간(워크덱 GA4 `G-5F8G9Y4VHW`, GTM 미사용)에 구글 마케팅 자격증명을 GA4 속성만으로 등록할 수 있게 한다.
목적: MCP `google_marketing_ga4_admin_get` 로 웹 스트림 `enhancedMeasurementSettings` 를 읽어 향상된 측정 OFF 를 검증하고(GA4 퍼널 운영 게이트), 4단계 주간 퍼널 리포트에 쓴다.

## 현재

- `app/api/spaces/[spaceId]/credentials/[provider]/route.ts` 의 `google-marketing` 스키마가 브랜드마다 `ga4_property_id`·`gtm_account_id`·`gtm_container_id` 를 모두 숫자로 필수 요구.
- `resolveBrand`(src/lib/agent/integrations/google-marketing.ts) 도 세 id 를 모두 숫자로 강제. id 는 escape 없이 경로 검사 정규식에 들어간다(`targetPrefix`).

## 변경

1. route 스키마: `gtm_account_id`·`gtm_container_id` → `.optional()`(있으면 숫자) + 브랜드 객체에 `superRefine` 으로 **둘 다 있거나 둘 다 없음** 쌍 검증(저장 경계에서 400, 기존 자격증명 보존).
2. `GoogleConfig.brands` 타입: gtm 두 필드 optional.
3. `resolveBrand`: `ga4_property_id` 는 숫자 필수 유지. gtm 두 id 는 없거나 빈 문자열이면 `''`, 값이 있으면 숫자만 허용(아니면 기존처럼 에러). 한쪽만 있는 경우도 에러(둘 다 있거나 둘 다 없음).
4. `targetPrefix` 자체에서(따라서 `assertPathInTarget`·`actionUrl` 의 리소스 정규식 구성 양쪽 모두): `api === 'gtm'` 인데 gtm id 가 `''` 면 경로 검사 전에 `ToolUserError('이 브랜드에는 GTM 컨테이너가 설정되지 않았습니다')`. → GTM 조회 도구·GTM 액션 제안/실행 모두 이 함수를 거치므로 한 곳에서 막힌다(빈 id 가 정규식에 들어가 `accounts//containers/` 같은 접두로 다른 경로를 통과시키는 일 없음).
5. actions `baseSchema.target` 의 gtm id: `^\d*$`(빈 값 허용). `assertGoogleTarget` 은 현재 config 를 다시 resolve 해 문자열 동등 비교하므로, 위조 target(빈 gtm 을 넣어 다른 브랜드 흉내 등)은 config 와 달라 거부된다.
6. 등록 화면 `src/components/integrations/ad-credential-form.tsx`: Field 에 `optional` 추가, google-marketing 의 GTM 두 칸을 「(선택)」 으로 표시. 빈 optional 칸은 필수 검사에서 제외, 두 칸 쌍 검증(한쪽만 → 안내 메시지). `build` 는 GTM 이 비면 두 키를 payload 에서 생략.

## 검증

- 단위 테스트(google-marketing.test.ts): gtm 없이 resolve → gtm `''`; gtm 한쪽만 → 에러; 비숫자 → 에러; gtm 미설정 브랜드로 GTM 경로 `assertPathInTarget` → 에러; GA4 경로는 정상. 기존 `gtm_account_id: ''` 거부 테스트는 「한쪽만 설정」 에러로 의미를 바꿔 유지.
- route 테스트: gtm 생략 PUT 200, 한쪽만 PUT 400 + 기존 행 미변경.
- 폼 테스트(ad-credential-form.test.tsx): GTM 비우고 저장 → payload 에 gtm 키 없음; 한쪽만 → 오류 문구·PUT 미호출.
- 액션 신뢰 경계 테스트: GTM 미설정 config 에서 GTM 액션(pathKey 있는 것·없는 workspace.create) 제안/검증/실행 모두 거부, GA4 액션은 통과, 위조 target(gtm id 끼워넣기) 거부.
- tsc, eslint, 관련 jest.

## 롤백

- 기존 자격증명(AML: gtm 포함)은 형식 그대로 유효 — 하위 호환.
- revert 하면 GTM 없이 저장된 자격증명은 이전 `resolveBrand` 에서 실패한다. revert 전 `SpaceCredential`(provider google-marketing) 중 brands 에 gtm 키 없는 행을 조회(현재 대상은 Kaleos 1건 예정)하고, 해당 공간에서 설정 화면으로 연결 해제한 뒤 revert 한다. 이 기능을 쓰는 대기 승인 액션은 GA4 조회만이라 없다(조회 전용 확인).

## Codex 검토 반영 (2026-11-21)

지적 4건 — 반영 4: ① 등록 화면 폼 선택 항목화(6) ② 저장 경계 쌍 검증(1) ③ 롤백 절차 명시 ④ 액션 제안·실행 신뢰 경계 테스트 + targetPrefix 단일 가드.
