---
name: workdeck-ui
description: Workdeck 앱의 운영형 UI를 설계하거나 수정할 때 사용한다. 페이지 레이아웃, 필터, 테이블, 상태 배지, 인터랙션, 시각 품질을 Workdeck 디자인 시스템에 맞춰 구현해야 할 때 적용한다.
---

# Workdeck UI Skill

Workdeck UI 작업은 `DESIGN.md`를 최우선 기준으로 삼는다. 외부 UI/UX 스킬이나 레퍼런스는 아이디어의 출처일 뿐이며, 색상, 밀도, 컴포넌트 사용, 상태 표현은 항상 이 저장소의 디자인 가이드와 기존 화면 패턴을 따른다.

## 시작 절차

1. `DESIGN.md`를 먼저 읽고 현재 작업에 필요한 색상, 컴포넌트, 밀도, 상태 표현 규칙을 확인한다.
2. 대상 route와 feature component를 읽어 데이터 흐름, URL state, loading/empty/error 상태를 파악한다.
3. 첨부된 screenshot이나 source reference가 있으면 실제 문제를 구체적으로 적는다.
4. UI 변경 전 실패하는 테스트를 먼저 추가하거나 기존 테스트를 요구사항에 맞게 갱신한다.
5. 변경은 관련 feature boundary 안에서 끝낸다. unrelated refactor는 피한다.

## 디자인 원칙

- Workdeck은 운영형 SaaS다. 화면은 조용하고 밀도 있게, 반복 작업과 비교가 쉬워야 한다.
- selection, active, focus 색상은 `DESIGN.md`의 primary/neutral 계열을 사용한다. 임의의 blue/purple 강조색을 새로 만들지 않는다.
- status 색상은 의미별로 일관되게 쓴다: red=결품/위험, amber=부족/주의, emerald=정상, indigo/blue=과잉 또는 보조 정보.
- 테이블은 스캔성과 열 안정성이 우선이다. 고정 열, tabular number, compact row, sticky header를 유지한다.
- 상태 수량은 불필요한 사각 card grid보다 badge, label, sticker, pill 같은 가벼운 표현을 우선한다.
- 필터는 데이터가 적용되는 영역 가까이에 둔다. product list 필터는 product panel 안에, table/detail 필터는 detail 영역에 둔다.
- 좌우 panel이 있는 화면은 collapse affordance와 collapsed 상태의 명확한 복구 동작을 제공한다.
- card 안에 card를 중첩하지 않는다. 반복 item만 card-like surface를 허용한다.
- icon button에는 접근 가능한 `aria-label`을 둔다.

## 구현 체크리스트

- URL state와 local UI state의 책임을 분리한다.
- 정렬 기준은 사용자가 찾는 순서를 따른다. 별도 요구가 없으면 한국어 이름순을 우선한다.
- pin/favorite 같은 개인화 상태는 서버 요구가 없으면 `localStorage`로 작게 시작하고 key 이름을 feature scope로 제한한다.
- table column을 줄일 때 제거한 정보는 row heading, section title, subtitle 등 더 적절한 위치로 옮긴다.
- location, status, brand, category 같은 filter는 서로 어느 데이터 집합에 적용되는지 테스트로 고정한다.
- responsive layout에서 텍스트가 버튼, 탭, 표 셀을 넘치지 않는지 확인한다.
- loading, empty, no-result 상태를 기존 컴포넌트 스타일로 유지한다.

## 검증

작업 완료 전 최소한 다음을 실행한다.

```bash
npm test -- <changed-tests> --runInBand
npm run typecheck
npm run lint
npm run build
```

UI 변경은 가능하면 local dev server에서 대상 화면을 열어 desktop/mobile 폭을 확인한다. 인증이나 외부 데이터 때문에 직접 확인할 수 없으면 어떤 검증이 막혔는지 최종 보고에 명시한다.

## 참고

이 스킬은 `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`의 UI 품질 점검 관점을 Workdeck 저장소에 맞게 축약한 것이다. 실제 구현 판단은 항상 `DESIGN.md`, 현재 코드, 사용자 요구사항 순서로 결정한다.
