import { FONT_FAMILY, __workdeckFonts } from '@excalidraw/excalidraw'
import metrics from '@/lib/hiring/opening-font-metrics.json'

const FAMILIES = [
  {
    name: 'Pretendard',
    files: [
      [400, 'Pretendard-Regular.woff2'],
      [600, 'Pretendard-SemiBold.woff2'],
      [700, 'Pretendard-Bold.woff2'],
      [800, 'Pretendard-ExtraBold.woff2'],
    ],
  },
  { name: 'GangwonPower', files: [[400, 'GangwonPower.otf']] },
  {
    name: 'Maruburi',
    files: [
      [300, 'MaruBuri-Light.ttf'],
      [400, 'MaruBuri-Regular.ttf'],
      [600, 'MaruBuri-SemiBold.ttf'],
      [700, 'MaruBuri-Bold.ttf'],
    ],
  },
  { name: 'Vidaloka', files: [[400, 'Vidaloka-Regular.ttf']] },
  {
    name: 'Montserrat',
    files: [
      [300, 'Montserrat-Light.ttf'],
      [600, 'Montserrat-SemiBold.ttf'],
      [800, 'Montserrat-ExtraBold.ttf'],
      [900, 'Montserrat-Black.ttf'],
    ],
  },
  { name: 'GangwonEduHyeonok', files: [[400, 'GangwonEduHyeonok.ttf']] },
] as const

type TextElement = Record<string, unknown>

function decodeFont(id: unknown) {
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  const family = Math.floor((id - 10000) / 1000)
  const weight = (id - 10000) % 1000
  if (family < 1 || family > 6 || weight < 100 || weight > 900 || weight % 100 !== 0) return null
  return { family, weight, alias: `${FAMILIES[family - 1].name}-${weight}` }
}

// 원본 source가 남은 최초 이관만 변환한다. 저장 후 native 폰트 선택은 재해석하지 않는다.
export function convertOpeningScene<T extends { elements?: readonly unknown[] | null }>(
  scene: T
): T {
  if ((scene as { source?: unknown }).source !== 'https://opening.work') return scene
  const elements = (scene.elements ?? []).map((value) => {
    if (!value || typeof value !== 'object') return value
    const element = value as TextElement
    if (element.type !== 'text' || decodeFont(element.fontFamily)) return value
    const { fontFamily, fontWeight, fontSize, height, baseline, lineHeight } = element
    if (
      typeof fontFamily !== 'number' ||
      !Number.isInteger(fontFamily) ||
      fontFamily < 1 ||
      fontFamily > 6 ||
      typeof fontWeight !== 'number' ||
      fontWeight < 100 ||
      fontWeight > 900 ||
      fontWeight % 100 !== 0
    ) {
      throw new Error('원본 디자인의 글꼴 또는 굵기를 확인할 수 없습니다.')
    }
    if (
      typeof fontSize !== 'number' ||
      !Number.isFinite(fontSize) ||
      fontSize <= 0 ||
      typeof height !== 'number' ||
      !Number.isFinite(height) ||
      height <= 0 ||
      typeof baseline !== 'number' ||
      !Number.isFinite(baseline) ||
      baseline < 0 ||
      baseline > height ||
      typeof lineHeight !== 'number' ||
      !Number.isFinite(lineHeight) ||
      lineHeight <= 0
    ) {
      throw new Error('원본 디자인의 텍스트 기준선을 확인할 수 없습니다.')
    }
    const centerRatio = lineHeight - (2 * (height - baseline)) / fontSize
    if (!Number.isFinite(centerRatio))
      throw new Error('원본 디자인의 텍스트 기준선을 확인할 수 없습니다.')
    const id = 10000 + fontFamily * 1000 + fontWeight
    return {
      ...element,
      fontFamily: id,
      customData: {
        ...(element.customData && typeof element.customData === 'object' ? element.customData : {}),
        wdOpeningBaseline: {
          fontFamily: id,
          centerRatio,
        },
      },
    }
  })
  const converted = { ...scene, elements } as T & { source?: unknown }
  delete converted.source
  return converted
}

export function hasOpeningFonts(elements: readonly unknown[]): boolean {
  return elements.some(
    (element) =>
      !!element &&
      typeof element === 'object' &&
      (element as TextElement).type === 'text' &&
      !!decodeFont((element as TextElement).fontFamily)
  )
}

// 원본에 있던 모든 weight를 alias에 등록해 브라우저의 CSS 매칭·합성 규칙도 보존한다.
export function loadOpeningFonts(elements: readonly unknown[]): Promise<void> | undefined {
  const used = new Map<number, string>()
  for (const value of elements) {
    if (!value || typeof value !== 'object') continue
    const element = value as TextElement
    if (element.type !== 'text' || !decodeFont(element.fontFamily)) continue
    const id = element.fontFamily as number
    used.set(id, (used.get(id) ?? '') + (typeof element.text === 'string' ? element.text : ''))
  }
  if (!used.size) return
  return Promise.all(
    [...used].map(async ([id, characters]) => {
      if (typeof document === 'undefined' || !document.fonts)
        throw new Error('글꼴을 불러올 수 없는 브라우저입니다.')
      const { family, weight, alias } = decodeFont(id)!
      ;(FONT_FAMILY as Record<string, number>)[alias] = id
      const fontMetrics = metrics[String(family) as keyof typeof metrics]
      const previous = __workdeckFonts.registered.get(id)
      if (previous?.fontFaces.some(({ fontFace }) => fontFace.status === 'error')) {
        for (const { fontFace } of previous.fontFaces) document.fonts.delete(fontFace)
        __workdeckFonts.registered.delete(id)
      }
      __workdeckFonts.register(
        alias,
        { metrics: { ...fontMetrics, unitsPerEm: fontMetrics.unitsPerEm as 1000 | 1024 | 2048 } },
        ...FAMILIES[family - 1].files.map(([fileWeight, filename]) => ({
          uri: `${window.location.origin}/fonts/hiring/opening/${filename}`,
          descriptors: { weight: String(fileWeight) },
        }))
      )
      const registered = __workdeckFonts.registered.get(id)
      if (!registered) throw new Error('원본 디자인 글꼴 등록에 실패했습니다.')
      for (const { fontFace } of registered.fontFaces) document.fonts.add(fontFace)
      const loaded = await document.fonts.load(`${weight} 16px "${alias}"`, characters || ' ')
      if (!loaded.length)
        throw new Error('원본 디자인 글꼴을 불러오지 못했습니다. 다시 시도해주세요.')
    })
  ).then(() => undefined)
}
