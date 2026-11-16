# 이관 디자인 원본 폰트 복원

## 요청과 범위

- 에디: 편집기 저장 시 폰트가 깨지지 않도록 원래 폰트를 설치한다.
- 후속 결정: AAK 공고는 유지. 테스트 계정 초대·변경·제거 없음. 의식주의·피크페이 안내 없음.
- 운영 데이터·기존 이미지 일괄 재저장 없음. /tmp/tplaudit 백업 유지.

## 확인한 원인

opening 포크는 fontFamily 1~6을 Pretendard/GangwonPower/Maruburi/Vidaloka/Montserrat/GangwonEduHyeonok로 사용한다. stock Excalidraw 0.18.1은 같은 ID를 다른 글꼴로 해석하며 fontWeight를 무시한다. 기존 CSS는 한글만 바꾸므로 영문·숫자·폭·굵기를 복원하지 못한다. 원본 29개 scene은 source=https://opening.work이며 2개 대체 블록은 localhost 출처다.

## 구현

1. 원본 포크의 6개 폰트와 제공 웨이트를 public/fonts/hiring/opening에 설치하고 출처·라이선스를 동봉한다. 외부 CDN이나 OS 설치에 의존하지 않는다.
2. src/components/hiring-posts/opening-fonts.ts: 원본 source가 https://opening.work인 scene의 text만 변환. 전용 ID=10000+기존 family\*1000+weight(100~900)로 원본 family와 weight를 인코딩한다. 각 ID에 고유 CSS family를 FONT_FAMILY에 추가한다. 기존 1~9 ID와 CSS는 변경하지 않는다. 같은 원본 폰트의 사용 가능한 웨이트 전부를 별칭으로 FontFace 등록해 브라우저 원래 웨이트 매칭·합성 규칙을 유지한다.
3. patch-package의 기존 Excalidraw 패치에 전용 ID에만 인코딩한 weight를 getFontString에 반영하는 국소 변경을 추가한다(dev/prod 동일). 별칭은 원본 문자 전체를 지원한다. 저장·복사·텍스트 편집·리사이즈에서도 fontFamily 하나로 굵기를 보존한다.
4. 좌표·폭·높이·줄바꿈·lineHeight·이미지를 변경하지 않는다. 원본 객체를 변이하지 않는다. 한 번 전용 ID로 바뀐 요소는 다시 매핑하지 않는다. 저장 scene은 전용 ID를 유지하며 기존 고객 폰트 변경은 이후 재오픈에도 그대로 둔다.
5. 편집기 mount 전 해당 scene 전용 폰트의 필요한 글자를 명시 load한다. 실패 시 편집기·저장을 열지 않고 오류와 다시 시도 버튼을 보여준다. export 직전 실제 사용 중인 전용 폰트 로드도 검증하며 실패를 무시하지 않는다.
6. 저장 scene에 source가 유실된 기존 블록은 근거 없이 재해석하지 않는다. 원본 출처가 없는 손상된 재저장 블록 복원은 이번 범위 밖이다.

## 검증

- 변환·재오픈·고객의 stock 폰트 변경 유지·stock scene 무변경·원본 불변·폰트 로드 실패 테스트.
- 실제 0.18.1 dev/prod bundle에서 weight 문자열·Canvas 렌더와 typing·재저장 확인.
- 원본 여섯 폰트/한글·영문·숫자/굵기/다중행을 포함한 브라우저 비교. 기존 golden 표본의 원본 PNG와 비교해 변화율 기록.
- 대상 Jest, npm run lint, npm run build, 타입 검사. 기존 실패는 변경분과 구분한다.

## 롤백

운영 이미지를 선제적으로 변경하지 않는다. 전용 ID가 저장된 뒤에는 폰트와 ID 리더를 제거하면 안 된다. 문제 시 편집기 진입을 중지하고 리더·폰트는 유지한 채 원인 수정한다. 기존 코드로 단순 revert해도 저장 데이터가 복구된다고 주장하지 않는다. 운영 배포 전 검증 결과와 이 한계를 보고한다.

## 구현 전 별도 검토 반영

High 1·Medium 2 전부 반영.

- 원본 baseline 보존: 변환 text customData에 custom family ID와 centerRatio=lineHeight-2*(height-baseline)/fontSize를 저장. Canvas·SVG getVerticalOffset에 element를 넘겨 family 일치 시 (lineHeightPx+fontSize*centerRatio)/2 사용. 크기·행 수 변화에도 stale baseline을 읽지 않는다. 다른 폰트로 바꾸면 metadata를 적용하지 않는다.
- Excalidraw 패치에 내부 Fonts 클래스의 \_\_workdeckFonts export(dev/prod/types)를 추가. 앱이 실제 폰트 metrics 및 원본 파일 경로와 함께 Fonts.register로 사용 중인 전용 ID 별칭을 등록한다. source 판별과 변환은 앱에서만 담당한다.
- SVG text에도 전용 ID의 font-weight를 넣는다. stock SVG에는 속성을 추가하지 않는다.
- 별칭 등록은 편집기 mount 전. 실제 파일 metrics를 사용하고 기본 lineHeight는 original 1.4. 글꼴 변경 후 새 폰트 기준 측정, 저장/재오픈, textarea 진입/이탈을 브라우저에서 확인한다.

## 구현 결과와 검증 (2026-11-17)

- 원본 폰트 6종·15개 파일 설치 완료. 원본 바이트 SHA-256 일치, 내장 저작권·공식 라이선스 동봉. 저장소 의존성 추가 없음.
- 공고와 관리자 편집기가 공유하는 DesignBlock에서 source를 전달하지 않던 경로도 보완했다. Canvas에서 최초 변환 후 저장할 때 원본 source를 제거하므로 이후 사용자의 native 폰트 선택이 유지된다.
- Excalidraw의 TTF/OTF format 표기를 브라우저 표준 truetype/opentype으로 변환한다. 전용 font-face의 SVG weight/style descriptor도 보존한다. stock 폰트의 CSS 출력은 그대로다.
- 별도 최종 검토: Medium 1건(SVG font-face descriptor 누락) 수정 후 SPEC·코드 품질 PASS. 남은 blocking/high/medium 없음.
- 회귀 테스트 4 suites·31 tests 통과. source 판별/불변성/기하 보존, source 경유 실제 DesignBlock, 로드·재시도·닫기, native 선택 재오픈, dev/prod 실제 패치 함수, SVG face weight/style 및 stock CSS 동일성 검증.
- 전체 ESLint 오류 0·기존 경고 64. 변경 파일 lint 경고 없음. TypeScript 검사 통과.
- 깨끗한 npm @excalidraw/excalidraw@0.18.1에서 patch-package 적용 성공. 수정 6개 vendor 파일이 검증한 node_modules와 byte-for-byte 일치.

### 실제 Chrome 검증

- 6종 폰트와 모든 제공 weight 15개 파일 로드 성공. GangwonPower의 합성 Bold도 확인.
- 실제 ExcalidrawCanvas에서 한글·영문·숫자를 두 줄로 수정 → JPEG 저장 → 재오픈: 원래 family·weight 유지, 잘림 없음, page error 없음.
- native Normal 폰트로 변경 → 저장·재오픈: 고객이 고른 폰트 유지.
- 폰트 HTTP 404 강제 → 편집기·저장 차단 → 같은 화면 다시 시도(실패 face 재생성) → 정상 복구.
- SVG의 text weight, face weight/style과 WOFF2/TTF/OTF 데이터 임베딩 확인.
- 비교 원본: /tmp/tplaudit의 기존 공개 샘플 PNG. 같은 해상도에서 RGB 채널 차이가 32보다 큰 픽셀 비율. source별 원본 PNG의 렌더링 환경 차이가 있어 모든 픽셀의 동일성을 보장하지 않는다.

| 표본                   | 기존 편집기 | 수정본 |
| ---------------------- | ----------: | -----: |
| 호텔 공고소개          |     10.299% | 0.010% |
| 카페 공고소개          |      9.014% | 0.000% |
| 콜센터 인트로          |      6.262% | 0.027% |
| 사무지원 공고소개      |      6.209% | 0.020% |
| F&B 캐주얼 공고소개    |      8.863% | 0.040% |
| F&B 기본 공고소개      |      5.152% | 0.000% |
| F&B 기본 식당소개      |      6.443% | 0.130% |
| F&B 기본 복지혜택      |      2.888% | 0.520% |
| 매장관리 공고소개      |      8.174% | 0.027% |
| 오프라인 행사 프로그램 |      5.903% | 1.647% |

비교 이미지·브라우저 하네스·로그는 /tmp/workdeck-font-qa에 보관한다. 기존 운영 백업 /tmp/tplaudit은 삭제하지 않았다. AAK와 다른 공간 공고에 운영 쓰기를 하지 않았다.

### 검증 명령

```sh
npm test -- --runInBand src/components/hiring-posts/__tests__/opening-fonts.test.ts src/components/hiring-posts/__tests__/opening-font-patch.test.ts src/components/hiring-posts/__tests__/opening-font-canvas.test.tsx src/components/hiring-posts/__tests__/design-unsaved.test.tsx
npm run lint
npm run typecheck
```

이 worktree에는 .env.local이 없다. 기본 build는 컴파일·타입 검사 후 Supabase 환경 누락으로 정적 생성을 중단했다. 기존 기본 checkout의 개발 환경(tumkfkfgzkmisguyaghn)을 자식 process에 전달해 재검증한다. Node26의 --env-file 옵션을 Next worker에 직접 전달하면 ERR_WORKER_INVALID_EXEC_ARGV가 발생하므로 process.loadEnvFile과 spawnSync를 사용한다. 환경 파일·값은 복사하거나 커밋하지 않는다.

```sh
node -e 'process.loadEnvFile("/Users/kaleos/projects/kaleos/workdeck-app/.env.local"); const { status } = require("node:child_process").spawnSync("npm", ["run", "build"], { env: process.env, stdio: "inherit" }); process.exit(status ?? 1)'
```

최종 결과: 위 개발 환경 전달 방식의 `npm run build`가 2026-11-17 정상 종료(exit 0)했다. 385개 정적 페이지 생성과 production build를 완료했다.

## 배포 캐시 patch 호환성 보완 (2026-11-17)

Vercel이 이전 radius 전용 patch가 적용된 node_modules를 복구한 뒤 같은 파일명의 결합 font patch를 적용하면 postinstall이 실패했다. 기존 `@excalidraw+excalidraw+0.18.1.patch`를 원래 바이트 그대로 유지하고, 그 결과에서 font 변경만 적용하는 `@excalidraw+excalidraw+0.18.1+002+opening-fonts.patch`를 추가했다. 원본 npm 패키지와 기존 radius cache 양쪽에서 실제 patch-package CLI 적용·재적용 및 새 `.patch-package.json` cache 재사용을 검증한다. 여섯 runtime 파일은 이미 검증한 font 구현과 SHA-256이 일치하며 제품 동작 변경은 없다.

```sh
npm pack --offline --ignore-scripts @excalidraw/excalidraw@0.18.1 --pack-destination /tmp
node scripts/verify-excalidraw-patches.mjs /tmp/excalidraw-excalidraw-0.18.1.tgz
```

배포에 성공한 적 없는 결합 patch를 단독 적용한 로컬 node_modules에는 sequence 상태 파일이 없어 새 구조를 자동 인식할 수 없다. 이 경우 Excalidraw 패키지만 원본으로 다시 설치한 뒤 표준 patch-package를 적용한다. 이를 지원하기 위한 runtime 우회나 검증 생략은 추가하지 않는다.
