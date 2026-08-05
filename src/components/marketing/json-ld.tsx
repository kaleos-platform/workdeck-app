/** 구조화 데이터(JSON-LD) 삽입 공용 컴포넌트. 서버 컴포넌트에서 사용. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  )
}
