/** @jest-environment node */
import { emailBlocks, renderEmail } from '../layout'

describe('renderEmail', () => {
  it('모든 텍스트 입력을 escape 한다', () => {
    const html = renderEmail({
      preheader: '<p>pre</p>',
      header: { kind: 'space', name: '"><img src=x>' },
      body: [
        emailBlocks.heading('<h>'),
        emailBlocks.paragraph('<i>'),
        emailBlocks.details([['<k>', '<v>']]),
        emailBlocks.linkRows([{ label: '<l>', value: '<n>', url: 'https://a/?x="y"' }]),
        emailBlocks.button('<b>', 'javascript:"x"'),
      ],
      footer: ['<f>'],
    })
    for (const raw of [
      '<p>pre',
      '<img',
      '<h>',
      '<i>',
      '<k>',
      '<v>',
      '<l>',
      '<n>',
      '<b>',
      '<f>',
      '"y"',
    ]) {
      expect(html).not.toContain(raw)
    }
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;')
  })

  it('워크덱 헤더는 라벨을 붙인다', () => {
    const html = renderEmail({
      preheader: '',
      header: { kind: 'workdeck', label: '모집 관리' },
      body: [],
      footer: [],
    })
    expect(html).toContain('Workdeck')
    expect(html).toContain(' · 모집 관리')
  })
})
