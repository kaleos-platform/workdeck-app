---
name: ui-plan
description: Workdeck 새 화면이나 큰 UI 개편을 구현하기 전에 와이어프레임으로 계획하고 에디가 그림을 직접 고쳐 승인받을 때 사용한다. 작은 수정에는 쓰지 않고 라이브 화면에서 바로 고친다.
---

# UI 시각 계획

글 대신 그림으로 계획하고, 승인된 뒤에 구현한다. 정본은 코드와 `DESIGN.md`(저장소 루트)이고 와이어프레임은 구조 합의용이다.

## 절차

1. 현재 화면을 캡처하고 대상 route와 컴포넌트를 읽는다.
2. `docs/design/plans/<task>/`에 아래를 만든다. `<task>`와 화면 이름은 영문 소문자·숫자·하이픈만 쓴다.
   - `flow.excalidraw`: 화면 흐름. 화면이 하나면 생략한다.
   - `<screen>.excalidraw`: 화면별 와이어프레임.
   - `plan.md`: 번호별 변경 이유. 번호당 한 줄.
3. 라이브 작업대를 띄우고 `/dev/plan/<task>`를 캡처해 겹침·잘림을 고친다.
4. 주소를 에디에게 보낸다. 설명을 길게 쓰지 않는다.
5. 에디가 저장하면 `git diff`로 바뀐 요소를 읽어 무엇이 바뀌었는지 요약한다. 의도가 불명확하면 추측하지 않고 묻는다.
6. 에디가 승인하면 구현한다. 끝나면 실제 화면과 와이어프레임을 나란히 보여 준다.

## 와이어프레임 규칙

- 회색조만 쓴다. 색은 위험·주의 표시가 꼭 필요할 때만 쓴다.
- 실제 라벨과 현실적인 데이터 예시를 쓴다. `Lorem`, `제목` 같은 자리표시자는 금지한다.
- 박스에 `src/components/ui` 컴포넌트 이름을 적는다.
- 바뀌는 곳에 ①②③ 번호를 달고 `plan.md`와 맞춘다.
- 픽셀 디자인을 하지 않는다. 구조, 순서, 밀도만 정한다.
- 실고객 데이터를 쓰지 않는다.

## 파일 형식

요소는 skeleton으로 쓰면 된다. 첫 로드 때 정식 형식으로 변환된다.

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "agent",
  "elements": [
    {
      "type": "rectangle",
      "id": "filter",
      "x": 24,
      "y": 70,
      "width": 852,
      "height": 48,
      "backgroundColor": "#f3f4f6",
      "fillStyle": "solid",
      "label": { "text": "① 필터 — Select" }
    },
    { "type": "text", "id": "title", "x": 24, "y": 20, "text": "재고 현황", "fontSize": 24 }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

데스크톱은 폭 900, 모바일은 폭 390 사각형을 바깥 틀로 그린다.

## 라이브 작업대

띄우는 법·보안 주의·화면 확인 계정은 `workdeck-ui` 스킬의 "라이브 작업대" 절을 따른다(`.claude/skills/workdeck-ui/SKILL.md`).

## 금지

- Hermes `excalidraw` 스킬의 `scripts/upload.py`: 화면 구조가 외부로 나간다.
- `/dev/plan`을 프로덕션에서 켜는 변경.
