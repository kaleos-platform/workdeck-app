# 샘플 템플릿 브랜드 정리 dry-run 도구 (one-off, 운영 쓰기 없음)

계획: `docs/superpowers/plans/2026-11-16-recruiting-sample-template-branding.md`
입력: `/tmp/tplaudit/<templateId>.json` (운영 읽기 결과). 산출: `/tmp/tplaudit/out/`.
node 26 은 .ts 를 바로 실행한다(tsx 없음). `/tmp/pwtool/node_modules` 의 playwright-core(+크롬)를 쓴다.

```bash
node scripts/hiring-sample-sanitize/sanitize.ts candidates  # decisions.json / decisions.md
node scripts/hiring-sample-sanitize/sanitize.ts scenes      # 정리 scene(out/scenes), 원본 PNG 다운로드(out/png), residual.md
node scripts/hiring-sample-sanitize/patch.ts coordcheck     # 좌표 매핑 확인 이미지 out/patch/coordcheck-*.png
node scripts/hiring-sample-sanitize/patch.ts patch          # 원본 PNG 픽셀 패치
```

## 방식

excalidraw 재렌더는 opening 전용 폰트 체계 때문에 굵기·서체가 깨져 폐기했다. 대신 원본 PNG 에서
바뀐 텍스트·제거 로고 요소의 bbox 만 주변(링) 색으로 지우고, 새 텍스트를 Pretendard(`public/fonts/hiring`)로 다시 그린다.

- 링 색이 균일하지 않거나(std>12, 중앙색 근접 85% 미만) 회전 요소·프레임 없음·프레임 50% 이상 로고면 `review`.
- 산출(`out/patch/`): `<contentId>.after.png`, `sheets/*.png`(before|after), `report.md`, `manifest.json`.

## 반영(apply.ts)

```bash
node scripts/hiring-sample-sanitize/apply.ts --plan          # 로그인 없이 작업 목록(op 별 건수)
node scripts/hiring-sample-sanitize/apply.ts                 # --dry-run(기본): 로그인 후 GET 만, 현재 data 해시 == 원본 해시 전수 대조
node scripts/hiring-sample-sanitize/apply.ts --apply [--only id,..] [--include-masked id,..|all]
node scripts/hiring-sample-sanitize/apply.ts --rollback [--only id,..]
```

headful 크롬(`/tmp/tplaudit/admin-profile`)에서 사람이 admin 에 로그인·2단계 인증을 하면 진행한다. 상태는 `/tmp/tplaudit/out/apply-state.json`, 백업은 `/tmp/tplaudit/backup/<timestamp>/`.
manifest op: `patch`(data+PNG), `image`(PNG 만), `delete`(블록 삭제), `cover`(템플릿 커버 = 반영 후 첫 블록 imagePath).
