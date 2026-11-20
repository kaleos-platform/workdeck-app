// 오프닝 이용 종료(UTC 문자열) → 워크덱 체험 종료 시각. DB·시계 무접근 순수 함수.
// 입력 'YYYY-MM-DD HH:MM:SS[.fff]' (UTC) → +9h 의 KST 날짜 D → 마지막 이용일 D+7일
// → 종료 시각 = (D+8일) 00:00 KST. set-trial 과 같은 의미(지정 날짜 다음 날 00:00 KST).
const KST_MS = 9 * 3600_000
const DAY_MS = 24 * 3600_000

export function openingTrialEnd(utcText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(utcText ?? '')
  if (!m) throw new Error(`오프닝 종료 시각 형식 오류: ${utcText}`)
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  const kst = Date.UTC(y, mo - 1, d, h, mi, s) + KST_MS
  const kstDayStart = Math.floor(kst / DAY_MS) * DAY_MS // KST 날짜 D 의 00:00 (UTC 시계로 표현)
  return new Date(kstDayStart + 8 * DAY_MS - KST_MS)
}
