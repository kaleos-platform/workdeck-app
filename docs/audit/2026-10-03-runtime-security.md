# 2026-10-03 런타임 의존성 보안 갱신

## 변경 범위

- `next`, `eslint-config-next`: 16.1.6 → 16.3.8. Next.js 및 동반 SWC/ESLint 의존성을 함께 갱신했다.
- `handlebars`: 4.7.8 → 4.7.9. `ts-jest`의 개발 전이 의존성으로, 직접 의존성을 추가하지 않고 lockfile만 갱신했다.
- `xlsx`: 0.18.5 → 공식 CDN의 0.20.3 tarball. [SheetJS 공식 설치 문서](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)는 npm registry가 오래된 0.18.5에 머물러 있으며 CDN을 배포 원본으로 명시한다. URL과 lockfile integrity를 고정했다.
- `jiti` 2.6.1 및 기존 React 19.2.4를 유지했다. 광범위한 `npm audit fix`나 `--force`는 사용하지 않았다.

SheetJS 변경은 shipping/inventory/finance의 Excel 파싱 경로에 해당한다. recruiting의 공개 첨부 업로드는 파일 저장 경로이며 Excel 파싱 경로와 구분한다.

## 검증 결과

| npm audit 범위       | low | moderate | high | critical | 합계 |
| -------------------- | --: | -------: | ---: | -------: | ---: |
| 변경 전 전체         |   3 |       55 |   71 |        2 |  131 |
| 변경 후 전체         |   3 |       55 |   68 |        0 |  126 |
| 변경 후 `--omit=dev` |   2 |       53 |   32 |        0 |   87 |

변경 후 `next`, `handlebars`, `xlsx`는 audit 취약 패키지 목록에 없다. audit 합계는 패키지 및 전이 경로 집계이며 독립적인 공격 경로 수가 아니다.

`npm ls next eslint-config-next handlebars xlsx jiti --depth=1`은 정상 종료했다. Excel 및 배송·재고 파서 테스트 4 suites, 26 tests가 통과했다:

```sh
npm test -- --runInBand src/lib/__tests__/excel-parser.test.ts src/lib/del/__tests__/channel-import-parser.test.ts src/lib/del/__tests__/channel-import-parser-orderdate.test.ts src/lib/inv/__tests__/reconciliation-parser.test.ts
```

원본 결과는 작업 환경의 `/private/tmp/workdeck-security-before.json`, `/private/tmp/workdeck-security-after.json`, `/private/tmp/workdeck-security-production-after.json`, `/private/tmp/workdeck-security-parser-tests.log`에 보관했다. 임시 파일은 저장소 산출물이 아니다.

## 남은 검증과 위험

전체 의존성 보안 점검이 완료된 것은 아니다. 런타임 분류에는 Excalidraw, Sentry, Tiptap, Prisma 관련 전이 취약점이 남는다. 특히 audit이 제안하는 Excalidraw/Prisma 및 일부 개발 도구의 이전 major로의 변경은 호환성을 검증하지 않은 채 적용하지 않았다. 별도 도달 가능성 검토와 범위별 업그레이드가 필요하다.

설치 중 기존 Excalidraw 내부 Radix 패키지의 React 18 peer 경고가 발생했다. Next.js 16.3.8의 peer 범위는 현재 React 19를 허용한다. 설치는 `--ignore-scripts`로 수행했으므로 Prisma 생성 및 기존 patch 적용은 통합 검증 단계에서 수행해야 한다. 전체 lint/typecheck/build 결과와 실제 배포·고객 이관 승인 여부는 통합 readiness 기록을 따른다.
