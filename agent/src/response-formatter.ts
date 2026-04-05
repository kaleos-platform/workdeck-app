// API 응답을 Slack 메시지로 포맷
export function formatResponse(title: string, data: unknown): string {
  const json = JSON.stringify(data, null, 2)
  const truncated = json.length > 2500 ? json.slice(0, 2500) + '\n...(생략)' : json
  return `*${title}*\n\`\`\`${truncated}\`\`\``
}
