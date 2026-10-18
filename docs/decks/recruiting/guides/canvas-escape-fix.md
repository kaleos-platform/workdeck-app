# 디자인 캔버스 Escape 입력 보존

2026-10-19. 고객 이전 준비의 담당자 디자인 카드 저장 QA에서 발견했다.

## 재현과 설계

로컬의 합성 초안에서 디자인 카드를 만들고 담당자 A를 입력했다. Cmd+Enter → 카드저장 후 전체 새로고침과 GET으로 scene 텍스트·export PNG 경로가 유지됨을 확인했다. 같은 텍스트를 담당자 B로 수정하며 캔버스가 안내하는 Escape를 누르면 바깥 Dialog가 닫혔다. 저장 전 입력은 사라지고 이전 저장값 A만 남는다. 신규 카드에서도 Escape 후 scene·이미지가 저장되지 않음을 확인했다.

Radix Dialog는 document capture에서 Escape를 처리한다. Excalidraw textarea가 Escape로 편집을 종료하기 전에 바깥 닫기 검증이 실행된다. canvas 내부 요소를 대상으로 한 Escape에만 DialogContent의 onEscapeKeyDown에서 preventDefault를 호출한다. 전파는 유지하여 Excalidraw 자체의 텍스트 완료·선택 해제를 허용한다. 캔버스 외부 Escape, 닫기 버튼, 일반 텍스트·이미지·버튼 팝업과 기존 미저장/저장 중 검증은 유지한다. 공통 Dialog·API·DB는 변경하지 않는다.

## 실행·검증 계획

1. 실제 Dialog와 캔버스 경계 stub으로 텍스트/도구 Escape의 팝업 조기 닫기 실패를 재현한다.
2. 해당 feature Dialog에만 보호를 추가하고 자식 키 처리·입력 보존·닫기 버튼·일반 팝업 Escape를 검사한다.
3. Aside에서 실제 Excalidraw의 Escape 후 팝업 유지 → 카드저장 → 새로고침·GET을 확인한다.
4. 관련 UI 테스트·TypeScript·lint·production build·리뷰를 통과한 변경만 배포한다.

## 자동 테스트

수정 전 4 tests 중 캔버스 Escape 2 tests 실패(onClose 호출 1회), 기존 닫기 버튼·일반 텍스트 Escape 2 tests 통과를 확인했다. 수정 후 결과와 브라우저 QA·배포 근거는 후속 기록으로 추가한다.

## 실제 브라우저 QA — 2026-10-19

개발 Supabase 프로젝트 `tumkfkfgzkmisguyaghn`과 localhost:3100의 기존 합성 QA 계정에서 실행했다. 운영 Supabase `duyteczbadcuvfeawlzu`와 다름을 확인했으며 운영 고객 공고는 수정하지 않았다. 검증 초안은 `cmvdyvrkb00003gjvmnmeli0k`(`[검증 전용] 담당자 카드 QA 20261019`)이다.

Aside의 실제 Excalidraw에서 담당자 A를 B로 변경하고 Escape를 눌렀다. 텍스트 편집만 끝나고 디자인 팝업·미저장 안내는 유지됐다. 카드저장 성공 toast를 확인한 뒤 닫기·전체 새로고침·GET으로 B 텍스트와 새 PNG 경로의 영속성을 확인했다. 알림 수신자 설정이나 실제 알림 발송을 검증한 결과는 아니다.

관련 UI 19 suites/98 tests, TypeScript, 전체 lint(오류 0·기존 경고 63), 독립 코드 리뷰를 통과했다. webpack production build도 exit 0으로 통과했다. PR CI·운영 반영은 후속 기록으로 확정한다.

모바일 접수 검증을 위해 합성 직무 1건과 모집 장소 없음을 설정했다. 지원 알림을 끄고 설정을 저장하려는 동작은 자동 승인 심사에서 알림 설정 변경의 구체적 승인 부재로 거부되어 실행되지 않았다. localhost·개발 DB 확인과 URL 가드를 추가해도 같은 이유로 거부됐다. 사용자에게 개발 합성 공고의 알림 비활성·발행·가상 접수·마감·검증 데이터/이미지 정리를 묶어 명시 승인 요청을 남겼다. 승인 전 모바일 접수나 해당 정리를 완료로 표시하지 않는다.
