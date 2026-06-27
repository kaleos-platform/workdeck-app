/**
 * K-IFRS 매핑 (client-safe — prisma import 없음).
 * 운영 항목 `code`(K-IFRS) → 공식 계정과목명 / 현금흐름 활동. 회계용 내보내기 + 매핑 검토 UI에서 공용.
 * (kifrs-seed.ts가 re-export하므로 서버 코드는 기존 import 경로 유지.)
 */

/** 현금흐름표 활동 분류. */
export type CfActivity = 'OPERATING' | 'INVESTING' | 'FINANCING'

/** K-IFRS 코드 → 현금흐름표 활동(매핑 없으면 영업활동). */
export const KIFRS_CF_MAP: Record<string, CfActivity> = {
  '4900': 'INVESTING', // 이자·금융수입
  '5500': 'FINANCING', // 대출이자
  '1500': 'INVESTING', // 설비·자산취득
  '2300': 'FINANCING', // 차입금
}

/** 코드 → 현금흐름 활동(매핑 없으면 영업활동). */
export function cfActivityForCode(code: string | null | undefined): CfActivity {
  if (!code) return 'OPERATING'
  return KIFRS_CF_MAP[code] ?? 'OPERATING'
}

/** 현금흐름 활동 → 한글 라벨. */
export const CF_ACTIVITY_LABEL: Record<CfActivity, string> = {
  OPERATING: '영업활동',
  INVESTING: '투자활동',
  FINANCING: '재무활동',
}

/**
 * K-IFRS 코드 → 공식 계정과목명. 운영 항목명은 비즈니스 언어라 회계 전달 시 공식 명칭으로 환원한다.
 * 운영 항목이 다대일로 같은 코드를 공유한다(예: 5440 소모품비).
 */
export const KIFRS_ACCOUNT_NAMES: Record<string, string> = {
  '4100': '상품매출',
  '4200': '배송비수익',
  '4900': '이자수익',
  '4910': '잡이익',
  '5100': '상품매입(매출원가)',
  '5200': '지급수수료',
  '5210': '운반비',
  '5300': '광고선전비',
  '5400': '급여',
  '5410': '임차료',
  '5420': '세금과공과',
  '5430': '통신비',
  '5440': '소모품비',
  '5450': '복리후생비',
  '5500': '지급이자',
  '1100': '현금및현금성자산',
  '1130': '매출채권',
  '1200': '재고자산',
  '1500': '비품·시설장치',
  '2100': '매입채무',
  '2300': '단기차입금',
  '2310': '미지급금',
  '9100': '계좌간 이체',
}

/** 코드 → 공식 K-IFRS 계정과목명(매핑 없으면 빈 문자열). */
export function kifrsAccountName(code: string | null | undefined): string {
  if (!code) return ''
  return KIFRS_ACCOUNT_NAMES[code] ?? ''
}

/**
 * 매핑 Select 옵션 — 회계용 내보내기 단계에서 미매핑 운영 항목에 K-IFRS 계정을 지정할 때 사용.
 * `{ code, label }` 형태. (수입·비용·자산·부채 전부 — 사용자가 적절한 회계 계정 선택.)
 */
export const KIFRS_ACCOUNT_OPTIONS: { code: string; label: string }[] = Object.entries(
  KIFRS_ACCOUNT_NAMES
).map(([code, name]) => ({ code, label: `${code} · ${name}` }))
