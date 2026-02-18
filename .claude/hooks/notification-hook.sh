#!/bin/bash

# Claude Code Notification Hook
# notification_type에 따라 다양한 이벤트 처리
# stdin으로 전달되는 JSON에서 notification_type을 파싱

# 공통 라이브러리 로드
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/slack-notifier.sh"

# 프로젝트 디렉토리 설정 (Claude Code에서 자동 제공됨)
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# 환경 변수 로드
load_env

# stdin에서 JSON 읽기 및 파싱
input=$(cat)

# jq 명령어 확인
if ! command -v jq &> /dev/null; then
  echo "오류: jq가 설치되어 있지 않습니다. notification hook을 실행할 수 없습니다."
  log_notification "ERROR" "jq 명령어를 찾을 수 없음"
  exit 2
fi

notification_type=$(echo "$input" | jq -r '.notification_type // "unknown"')
notification_message=$(echo "$input" | jq -r '.message // ""')

# notification_type에 따라 메시지 설정
# permission_prompt: 권한 요청 시
# idle_prompt: 작업 완료 후 대기 상태
# elicitation_dialog: 추가 정보 요청 시
# auth_success: 인증 성공 시
case "$notification_type" in
  permission_prompt)
    title="권한 요청"
    message="Claude Code가 작업을 진행하기 위해 권한을 요청하고 있습니다. 원본 메시지: $notification_message"
    color="$COLOR_WARNING"
    log_notification "INFO" "permission_prompt 알림 전송: 권한 요청"
    ;;
  idle_prompt)
    title="작업 완료"
    message="Claude Code가 작업을 완료하고 대기 중입니다. 다음 명령을 입력해주세요."
    color="$COLOR_GOOD"
    log_notification "INFO" "idle_prompt 알림 전송: 작업 완료"
    ;;
  elicitation_dialog)
    title="추가 정보 필요"
    message="Claude Code가 명령을 실행하기 위해 추가 정보를 요청하고 있습니다. 원본 메시지: $notification_message"
    color="$COLOR_WARNING"
    log_notification "INFO" "elicitation_dialog 알림 전송: 추가 정보 필요"
    ;;
  auth_success)
    title="인증 성공"
    message="Claude Code 인증이 성공했습니다."
    color="$COLOR_GOOD"
    log_notification "INFO" "auth_success 알림 전송: 인증 성공"
    ;;
  *)
    title="알림"
    message="Claude Code에서 알림이 발생했습니다. 타입: $notification_type / 메시지: $notification_message"
    color="$COLOR_INFO"
    log_notification "WARN" "미지의 notification 타입: $notification_type"
    ;;
esac

# 슬랙 알림 전송
send_slack_notification "$title" "$message" "$color"

exit 0
