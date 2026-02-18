#!/bin/bash

# Claude Code PostToolUse Hook
# 도구 실행 완료 후 처리
# 1. 에러 감지 및 알림
# 2. 특정 도구(git commit, npm run build 등) 성공 알림

# 공통 라이브러리 로드
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/slack-notifier.sh"

# 프로젝트 디렉토리 설정
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# 환경 변수 로드
load_env

# Claude Code Hook에서 제공하는 도구 정보
tool_name="${TOOL_NAME:-unknown}"
tool_status="${TOOL_STATUS:-unknown}"
tool_command="${TOOL_COMMAND:-}"
tool_error="${TOOL_ERROR:-}"

# 도구 결과 로깅
log_notification "DEBUG" "도구 실행 완료: $tool_name, 상태: $tool_status"

# ============================================================================
# PART 1: 에러 감지 및 알림
# ============================================================================
if [ "$tool_status" = "error" ] || [ "$tool_status" = "failed" ]; then
  title="도구 실행 에러"

  # 에러 메시지 정제 (민감 정보 마스킹)
  sanitized_error=$(sanitize_message "$tool_error")

  message="도구: $tool_name
명령어: $tool_command
에러: $sanitized_error"

  color="$COLOR_DANGER"

  log_notification "ERROR" "도구 에러 알림: $tool_name - $sanitized_error"
  send_slack_notification "$title" "$message" "$color"
  exit 0
fi

# ============================================================================
# PART 2: 특정 도구 성공 알림
# ============================================================================

# 도구 명령어 기반으로 특정 패턴 매칭
# 패턴: 도구명 및 명령어에 따라 필터링

if [ "$tool_name" = "Bash" ]; then
  # Git 커밋 관련 명령어
  if [[ "$tool_command" =~ ^git[[:space:]]+commit ]]; then
    title="Git 커밋 완료"
    message="커밋이 성공적으로 완료되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "git commit 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # npm run build 관련
  if [[ "$tool_command" =~ npm[[:space:]]+run[[:space:]]+build ]]; then
    title="빌드 완료"
    message="프로젝트 빌드가 성공적으로 완료되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "npm run build 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # Prisma 관련 명령어 (마이그레이션, generate 등)
  if [[ "$tool_command" =~ npx[[:space:]]+prisma ]]; then
    # 더 구체적인 명령어 파싱
    if [[ "$tool_command" =~ prisma[[:space:]]+migrate ]]; then
      title="Prisma 마이그레이션 완료"
      message="데이터베이스 마이그레이션이 성공적으로 완료되었습니다.
명령어: $tool_command"
      log_notification "INFO" "prisma migrate 성공 알림"
    else
      title="Prisma 명령 실행 완료"
      message="Prisma 명령이 성공적으로 완료되었습니다.
명령어: $tool_command"
      log_notification "INFO" "prisma 명령 성공 알림"
    fi
    color="$COLOR_GOOD"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # Git push/pull
  if [[ "$tool_command" =~ ^git[[:space:]]+push ]]; then
    title="Git Push 완료"
    message="변경사항이 원격 저장소에 푸시되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "git push 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  if [[ "$tool_command" =~ ^git[[:space:]]+pull ]]; then
    title="Git Pull 완료"
    message="원격 저장소의 변경사항을 가져왔습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "git pull 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # Docker 관련 명령어 (있을 경우)
  if [[ "$tool_command" =~ ^docker[[:space:]]+(build|push) ]]; then
    title="Docker 빌드/푸시 완료"
    message="Docker 이미지 작업이 완료되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "docker 명령 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # npm install/update
  if [[ "$tool_command" =~ npm[[:space:]]+(install|update|ci) ]]; then
    title="패키지 설치 완료"
    message="NPM 패키지가 성공적으로 설치/업데이트되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "npm install/update 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

  # TypeScript 컴파일
  if [[ "$tool_command" =~ (tsc|npx[[:space:]]+tsc) ]]; then
    title="TypeScript 컴파일 완료"
    message="TypeScript 컴파일이 성공적으로 완료되었습니다.
명령어: $tool_command"
    color="$COLOR_GOOD"
    log_notification "INFO" "typescript 컴파일 성공 알림"
    send_slack_notification "$title" "$message" "$color"
    exit 0
  fi

fi

# ============================================================================
# PART 3: 다른 도구 성공 처리 (선택적)
# ============================================================================

# Write, Edit, Read 등의 도구는 기본적으로 알림 안함
# 필요시 아래 주석을 해제하여 활성화 가능

# if [ "$tool_name" = "Write" ] || [ "$tool_name" = "Edit" ]; then
#   title="파일 수정 완료"
#   message="파일이 성공적으로 수정되었습니다.
# 도구: $tool_name"
#   color="$COLOR_INFO"
#   log_notification "INFO" "파일 수정 성공 알림"
#   send_slack_notification "$title" "$message" "$color"
# fi

# ============================================================================
# PART 4: 명시적 수행 없음 (기본 성공 케이스)
# ============================================================================

# 위의 특정 패턴에 매칭되지 않는 성공한 도구 사용은
# 알림을 보내지 않음 (과도한 알림 방지)

log_notification "DEBUG" "PostToolUse Hook: 특정 패턴에 미매칭 ($tool_name: $tool_command)"

exit 0
