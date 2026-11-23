/** 구조화 데이터(JSON-LD) 삽입 공용 컴포넌트. 서버 컴포넌트에서 사용. */

// <script> 탈출(`</script>`)·HTML 파서 모호성 방지 — JSON 안에서 안전한 \u 이스케이프로 치환한다.
const ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (ch) => ESCAPES[ch])
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
