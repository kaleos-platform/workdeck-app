/** @jest-environment node */
import { readFileSync } from 'node:fs'

const root = 'node_modules/@excalidraw/excalidraw/dist/'
const dev = readFileSync(root + 'dev/chunk-4FTI6OG3.js', 'utf8')
const prod = readFileSync(root + 'prod/chunk-K2UTITRG.js', 'utf8')

it.each([
  [
    'dev',
    dev,
    /var getFontString = ([\s\S]*?);\nvar debounce/,
    /var getVerticalOffset = ([\s\S]*?);\nvar getLineHeight/,
  ],
  ['prod', prod, /Ee=([\s\S]*?),\$o=/, /Go=([\s\S]*?),ko=/],
] as const)(
  '%s는 원본 weight와 기준선을 Canvas·SVG 모두에 적용하며 native 선택을 보존한다',
  (_, source, fontPattern, offsetPattern) => {
    const getFont = new Function(
      'getFontFamilyString',
      'ea',
      `return (${source.match(fontPattern)![1]})`
    )(
      () => 'Family',
      () => 'Family'
    )
    expect(getFont({ fontFamily: 11600, fontSize: 20 })).toBe('600 20px Family')
    for (const fontFamily of [1, 6, 11000, 11101, 17000])
      expect(getFont({ fontFamily, fontSize: 20 })).toBe('20px Family')
    const Fonts = {
      registered: new Map([
        [11600, { metadata: { metrics: { unitsPerEm: 1000, ascender: 900, descender: -200 } } }],
      ]),
    }
    const getOffset = new Function('Fonts', 'Nn', `return (${source.match(offsetPattern)![1]})`)(
      Fonts,
      Fonts
    )
    const element = { customData: { wdOpeningBaseline: { fontFamily: 11600, centerRatio: 0.3 } } }
    expect(getOffset(11600, 20, 28, element)).toBe(17)
    expect(getOffset(11600, 40, 56, element)).toBe(34)
    element.customData.wdOpeningBaseline.fontFamily = 2
    expect(getOffset(11600, 20, 28, element)).toBe(21)
    element.customData.wdOpeningBaseline.centerRatio = 0
    expect(getOffset(11600, 20, 28, element)).toBe(21)
    expect(source).toContain('font-weight')
    expect(source).toMatch(/lineHeightPx,\s*element|Go\(e.fontFamily,e.fontSize,[A-Za-z]+,e\)/)
  }
)

it.each([
  ['dev', dev, /static getFormat\(url\) \{([\s\S]*?)\n  \}\n  static normalizeBaseUrl/],
  ['prod', prod, /static getFormat\(t\)\{([\s\S]*?)\}static normalizeBaseUrl/],
] as const)('%s는 원본 TTF·OTF를 유효한 CSS font format으로 등록한다', (_, source, pattern) => {
  const format = new Function('url', 't', source.match(pattern)![1])
  for (const [extension, expected] of [
    ['ttf', 'truetype'],
    ['otf', 'opentype'],
    ['woff2', 'woff2'],
  ]) {
    const url = new URL(`https://workdeck.test/fonts/test.${extension}`)
    expect(format(url, url)).toBe(`format('${expected}')`)
  }
})

it.each([
  ['dev', dev, /  toCSS\(characters\) \{([\s\S]*?)\n  \}\n  \/\*\*/],
  ['prod', prod, /toCSS\(t\)\{([\s\S]*?)\}async getContent/],
] as const)(
  '%s SVG CSS는 custom alias의 각 실제 face weight·style을 보존하고 native CSS는 유지한다',
  async (_, source, pattern) => {
    const families = { 'Pretendard-600': 11600, Virgil: 1, Invalid: 11101 }
    const toCSS = new Function(
      'FONT_FAMILY',
      'Ie',
      `return function(characters) { const t = characters; ${source.match(pattern)![1]} }`
    )(families, families)
    const content = 'data:font/woff2;base64,test'
    const face = {
      fontFace: { family: 'Pretendard-600', weight: '400', style: 'normal' },
      getUnicodeRangeRegex: () => /./u,
      getContent: jest.fn(async () => content),
    }
    for (const weight of ['400', '600', '700', '800']) {
      face.fontFace.weight = weight
      expect(await toCSS.call(face, '채용 ABC')).toBe(
        `@font-face { font-family: Pretendard-600; font-weight: ${weight}; font-style: normal; src: url(${content}); }`
      )
    }
    face.fontFace.style = 'italic'
    expect(await toCSS.call(face, 'ABC')).toContain('font-style: italic;')
    for (const family of ['Virgil', 'Invalid']) {
      face.fontFace.family = family
      expect(await toCSS.call(face, 'ABC')).toBe(
        `@font-face { font-family: ${family}; src: url(${content}); }`
      )
    }
    expect(face.getContent).toHaveBeenCalledWith([65, 66, 67])
  }
)
