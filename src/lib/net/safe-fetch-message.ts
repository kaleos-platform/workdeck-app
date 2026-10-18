import type { SafeFetchError } from '@/lib/net/safe-fetch'

// SafeFetchError 코드 → 사용자에게 보여줄 한국어 메시지.
// 내부 IP나 해석된 주소는 절대 노출하지 않는다 — 에러 원문 대신 고정 메시지만 사용.
export function mapSafeFetchError(err: SafeFetchError): string {
  switch (err.code) {
    case 'PRIVATE_ADDRESS':
    case 'SCHEME_NOT_ALLOWED':
    case 'USERINFO_NOT_ALLOWED':
    case 'PORT_NOT_ALLOWED':
      return '접근할 수 없는 주소입니다'
    case 'INVALID_URL':
      return 'URL 형식이 올바르지 않습니다'
    case 'DNS_FAILED':
      return '주소를 확인할 수 없습니다'
    case 'TOO_MANY_REDIRECTS':
      return '리다이렉트가 너무 많습니다'
    case 'TIMEOUT':
      return '페이지 응답이 너무 느립니다'
    case 'CONTENT_TYPE_NOT_ALLOWED':
      return 'HTML 페이지가 아닙니다'
    case 'HTTP_ERROR':
      return '페이지를 불러올 수 없습니다'
    case 'FETCH_FAILED':
    default:
      return '페이지를 가져오는 중 오류가 발생했습니다'
  }
}
