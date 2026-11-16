import { convertOpeningScene, loadOpeningFonts } from '../opening-fonts'
import { __workdeckFonts, FONT_FAMILY } from '@excalidraw/excalidraw'

jest.mock('@excalidraw/excalidraw', () => ({
  FONT_FAMILY: { Virgil: 1, Helvetica: 2 },
  __workdeckFonts: {
    registered: new Map(),
    register: jest.fn(function (family, metadata, ...faces) {
      this.registered.set((FONT_FAMILY as Record<string, number>)[family], {
        metadata,
        fontFaces: faces.map(() => ({ fontFace: {} })),
      })
    }),
  },
}))

const text = {
  type: 'text',
  fontFamily: 1,
  fontWeight: 600,
  fontSize: 20,
  lineHeight: 1.4,
  x: 1,
  y: 2,
  width: 120,
  height: 56,
  baseline: 49,
  text: '채용 ABC',
  customData: { other: true },
}
const legacy = () => ({
  source: 'https://opening.work',
  elements: [text],
  files: { image: {} },
  appState: {},
})

it('원본 source만 불변 변환하며 위치·줄높이·파일을 보존하고 baseline 비율을 기록한다', () => {
  const original = legacy()
  const converted = convertOpeningScene(original)
  expect(converted).not.toBe(original)
  expect(original.elements[0].fontFamily).toBe(1)
  expect(converted.source).toBeUndefined()
  expect(converted.files).toBe(original.files)
  expect(converted.elements[0]).toEqual({
    ...text,
    fontFamily: 11600,
    customData: { other: true, wdOpeningBaseline: { fontFamily: 11600, centerRatio: 0.7 } },
  })
  expect(convertOpeningScene({ ...original, source: 'workdeck' })).toEqual({
    ...original,
    source: 'workdeck',
  })
})

it('이미 변환한 폰트와 사용자가 선택한 native 폰트는 재편집 때 다시 변환하지 않는다', () => {
  const first = convertOpeningScene(legacy())
  expect(convertOpeningScene({ ...first, source: 'https://opening.work' }).elements).toEqual(
    first.elements
  )
  const native = { ...first, elements: [{ ...first.elements[0], fontFamily: 2 }] }
  expect(convertOpeningScene(native).elements[0].fontFamily).toBe(2)
})

it.each([
  { fontFamily: 9 },
  { fontWeight: '600' },
  { baseline: undefined },
  { fontSize: 0 },
  { fontSize: Number.MIN_VALUE },
  { lineHeight: NaN },
])('해석 불가능한 원본 텍스트는 차단한다: %j', (invalid) => {
  expect(() => convertOpeningScene({ ...legacy(), elements: [{ ...text, ...invalid }] })).toThrow()
})

it('alias마다 모든 원본 weight와 실제 metrics를 등록하고 사용 weight·문자로 로드한다', async () => {
  const load = jest.fn().mockResolvedValue([{}])
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: jest.fn(), load } })
  await loadOpeningFonts(convertOpeningScene(legacy()).elements)
  expect(load).toHaveBeenCalledWith('600 16px "Pretendard-600"', '채용 ABC')
  expect(__workdeckFonts.register).toHaveBeenCalledWith(
    'Pretendard-600',
    expect.objectContaining({
      metrics: expect.objectContaining({ unitsPerEm: 2048, ascender: 1950 }),
    }),
    ...[400, 600, 700, 800].map((weight) =>
      expect.objectContaining({ descriptors: { weight: String(weight) } })
    )
  )
})

it('face가 없거나 로드가 실패하면 저장을 허용하지 않고 재시도할 수 있다', async () => {
  const load = jest
    .fn()
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([{}])
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: jest.fn(), load } })
  const elements = convertOpeningScene(legacy()).elements
  await expect(loadOpeningFonts(elements)).rejects.toThrow()
  await expect(loadOpeningFonts(elements)).rejects.toThrow('offline')
  await expect(loadOpeningFonts(elements)).resolves.toBeUndefined()
})

it('실패한 FontFace를 재사용하지 않고 제거·재등록해 실제 재시도를 허용한다', async () => {
  const load = jest.fn().mockResolvedValue([{}])
  const remove = jest.fn()
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: jest.fn(), delete: remove, load },
  })
  const previous = { fontFace: { status: 'error' } }
  __workdeckFonts.registered.set(11600, { metadata: {} as never, fontFaces: [previous as never] })
  await loadOpeningFonts(convertOpeningScene(legacy()).elements)
  expect(remove).toHaveBeenCalledWith(previous.fontFace)
  expect(__workdeckFonts.registered.get(11600)!.fontFaces[0]).not.toBe(previous)
})
