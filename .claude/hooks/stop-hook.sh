#!/bin/bash

# Claude Code Stop Hook
# 메인 에이전트 종료 시 실행
# 세션 종료를 슬랙으로 알림

# 공통 라이브러리 로드
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/slack-notifier.sh"

# 프로젝트 디렉토리 설정
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# 환경 변수 로드
load_env

# 종료 이유 확인 (Claude Code Hook이 제공하거나 환경 변수로 전달)
# 기본값: 정상 종료
stop_reason="${STOP_REASON:-정상 종료}"

# 종료 상태 코드 확인
stop_code="${STOP_CODE:-0}"

# 종료 사유 설정 (상태 코드에 따라 더 구체적인 메시지)
case "$stop_code" in
  0)
    stop_reason="정상 종료"
    color="$COLOR_NEUTRAL"
    ;;
  1)
    stop_reason="에러로 인한 종료"
    color="$COLOR_DANGER"
    ;;
  130)
    stop_reason="사용자 중단 (Ctrl+C)"
    color="$COLOR_WARNING"
    ;;
  *)
    stop_reason="종료 (코드: $stop_code)"
    color="$COLOR_NEUTRAL"
    ;;
esac

# 응답 완료 메시지 구성
title="응답 완료"
message="Claude Code 응답이 완료되었습니다.
완료 사유: $stop_reason"

# 로깅
log_notification "INFO" "Stop Hook 실행: 종료 사유=$stop_reason, 상태 코드=$stop_code"

# 슬랙 알림 전송
send_slack_notification "$title" "$message" "$color"

exit 0
