import { renderToStaticMarkup } from 'react-dom/server'
import { JsonLd } from '../json-ld'

describe('JsonLd 이스케이프', () => {
  it('</script> 를 넣어도 script 탈출이 없고 파싱하면 원문이 복원된다', () => {
    const title = '</script><img src=x onerror=alert(1)> &   '
    const html = renderToStaticMarkup(<JsonLd data={{ '@type': 'JobPosting', title }} />)

    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelector('img')).toBeNull()
    expect(JSON.parse(doc.querySelector('script')!.textContent as string).title).toBe(title)
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html).not.toMatch(/<\/script>.*<\/script>/)
    expect(html).not.toContain(' ')
  })
})
