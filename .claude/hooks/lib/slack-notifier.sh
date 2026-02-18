#!/bin/bash

# Claude Code Slack 알림 공통 라이브러리
# 모든 Hook에서 사용하는 슬랙 알림 함수

# 슬랙 알림 전송 함수
send_slack_notification() {
  local title="$1"
  local message="$2"
  local color="${3:-#439FE0}"  # 기본 색상: 파란색
  local webhook_url="${CLAUDE_SLACK_WEBHOOK_URL}"

  # 웹훅 URL 확인
  if [ -z "$webhook_url" ]; then
    echo "[Slack] 웹훅 URL이 설정되지 않았습니다. .env.local 파일을 확인하세요."
    return 1
  fi

  # jq 명령어 확인
  if ! command -v jq &> /dev/null; then
    echo "[Slack] 오류: jq가 설치되어 있지 않습니다."
    return 1
  fi

  # 현재 시간과 프로젝트명
  local timestamp=$(date +%s)
  local project_name=$(basename "$(pwd)")
  local current_date=$(date '+%Y-%m-%d %H:%M:%S')

  # jq를 사용하여 JSON 페이로드 구성 (특수 문자 자동 이스케이프)
  local payload=$(jq -n \
    --arg title "$title" \
    --arg message "$message" \
    --arg color "$color" \
    --arg project "$project_name" \
    --arg timestamp "$timestamp" \
    --arg date "$current_date" \
    '{
      attachments: [{
        color: $color,
        title: ("Claude Code - " + $title),
        text: $message,
        footer: "Claude Code Agent",
        ts: ($timestamp | tonumber),
        fields: [
          {
            title: "프로젝트",
            value: $project,
            short: true
          },
          {
            title: "시간",
            value: $date,
            short: true
          }
        ]
      }]
    }')

  # Slack으로 POST 요청 (타임아웃 5초, silent 모드)
  curl -X POST \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    --max-time 5 \
    --silent \
    --fail \
    "$webhook_url" > /dev/null 2>&1

  local result=$?
  if [ $result -eq 0 ]; then
    echo "[Slack] ✓ 알림 전송 완료"
    return 0
  else
    if [ $result -eq 28 ]; then
      echo "[Slack] ✗ 알림 전송 실패: 타임아웃 (5초)"
    else
      echo "[Slack] ✗ 알림 전송 실패 (오류 코드: $result)"
    fi
    return 1
  fi
}

# 환경 변수 로드 (.env.local에서)
load_env() {
  local project_dir="${CLAUDE_PROJECT_DIR:-.}"
  local env_file="$project_dir/.env.local"

  if [ -f "$env_file" ]; then
    # .env.local에서 CLAUDE_SLACK_WEBHOOK_URL만 추출하여 export
    export $(grep -v '^#' "$env_file" | grep 'CLAUDE_SLACK_WEBHOOK_URL' | xargs)
    return 0
  else
    echo "[Slack] 경고: $env_file 파일을 찾을 수 없습니다."
    return 1
  fi
}

# 민감 정보 마스킹 함수 (선택적 사용)
sanitize_message() {
  local message="$1"

  # 민감한 패턴 제거
  # 환경 변수 값들: DATABASE_URL, API_KEY, SECRET, PASSWORD, TOKEN 등
  message=$(echo "$message" | sed -E 's/(DATABASE_URL|API_KEY|SECRET|PASSWORD|STRIPE_SECRET|SUPABASE_SERVICE_ROLE|JWT_SECRET|AUTH_TOKEN)=([^ "]+)/\1=***REDACTED***/g')

  # URL 스킴 이후의 자격증명 제거 (예: postgresql://user:password@host)
  message=$(echo "$message" | sed -E 's#(://)[^:/@]+:[^/@]+(@)#\1***:***\2#g')

  echo "$message"
}

# 레이트 리미팅 함수 (선택적 사용)
check_rate_limit() {
  local min_interval="${1:-60}"  # 기본값: 60초
  local temp_dir="/tmp/claude-code-hooks"
  local timestamp_file="$temp_dir/last-notification"

  # 임시 디렉토리 생성
  mkdir -p "$temp_dir" 2>/dev/null

  # 마지막 알림 시간 확인
  if [ -f "$timestamp_file" ]; then
    local last_time=$(cat "$timestamp_file" 2>/dev/null)
    local current_time=$(date +%s)
    local elapsed=$((current_time - last_time))

    if [ $elapsed -lt $min_interval ]; then
      echo "[Slack] 정보: 레이트 리미트 중 (${elapsed}초 경과, 최소 ${min_interval}초 필요)"
      return 1
    fi
  fi

  # 현재 시간 저장
  date +%s > "$timestamp_file" 2>/dev/null

  return 0
}

# 로깅 함수
log_notification() {
  local level="$1"
  local message="$2"
  local project_dir="${CLAUDE_PROJECT_DIR:-.}"
  local log_file="$project_dir/.claude/hooks/slack-notifications.log"

  # 로그 디렉토리 생성
  mkdir -p "$(dirname "$log_file")" 2>/dev/null

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $message" >> "$log_file" 2>/dev/null
}

# 지원하는 색상 상수 정의
COLOR_GOOD="good"              # 녹색
COLOR_WARNING="warning"        # 노란색
COLOR_DANGER="danger"          # 빨간색
COLOR_NEUTRAL="#808080"        # 회색
COLOR_INFO="#439FE0"           # 파란색
