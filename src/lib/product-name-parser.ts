// 상품명에서 순수 상품명 추출
export function parsePureProductName(productName: string | null): string {
  if (!productName) return ''
  const tokens = productName
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  return tokens[0] ?? ''
}

// 상품명에서 옵션명 추출
// 1) JSON 형식({"구성":"5P"}) 우선 파싱
// 2) 일반 문자열은 쉼표 기준으로 첫 토큰(상품명) 이후를 옵션으로 파싱
export function parseOptionName(productName: string | null): string | null {
  if (!productName) return null
  const raw = productName.trim()
  if (!raw || raw === '-') return null

  const jsonMatches = raw.matchAll(/\{"[^"]+":"([^"]+)"\}/g)
  const jsonValues = [...new Set([...jsonMatches].map((match) => match[1].trim()).filter(Boolean))]
  if (jsonValues.length > 0) return jsonValues.join('/')

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length <= 1) return null

  const optionTokens = tokens.slice(1).filter((token) => token !== '-')
  return optionTokens.length > 0 ? optionTokens.join('/') : null
}
