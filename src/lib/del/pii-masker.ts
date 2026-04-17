/**
 * PII 비식별화(마스킹) 유틸리티
 * 조회 시 개인정보를 부분적으로 가려서 표시한다.
 */

/**
 * 이름 마스킹: "김철수" → "김**"
 */
export function maskName(name: string): string {
  if (name.length <= 1) return '*'
  return name[0] + '*'.repeat(name.length - 1)
}

/**
 * 전화번호 마스킹: "010-1234-5678" → "010-****-5678"
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return '****'
  return digits.slice(0, 3) + '-****-' + digits.slice(-4)
}

/**
 * 주소 마스킹: "서울시 강남구 역삼동 123-4" → "서울시 강남구 ****"
 */
export function maskAddress(address: string): string {
  const parts = address.split(/\s+/)
  if (parts.length <= 2) return parts[0] + ' ****'
  return parts.slice(0, 2).join(' ') + ' ****'
}
