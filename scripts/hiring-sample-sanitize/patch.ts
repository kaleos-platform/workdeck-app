/* eslint-disable @typescript-eslint/no-explicit-any -- one-off 스크립트: scene JSON 은 any 로 다룸 */
/**
 * 원본 PNG 픽셀 패치 (one-off, 운영 쓰기 없음). excalidraw 재렌더 대신, 바뀐 텍스트·제거된 요소의 bbox 만 지우고
 * 새 텍스트를 Pretendard 로 다시 그린다. 나머지 픽셀은 원본 그대로.
 *   node scripts/hiring-sample-sanitize/patch.ts coordcheck|patch
 * 입력: /tmp/tplaudit/<templateId>.json, out/scenes/<contentId>.json(sanitize.ts scenes), out/png/<contentId>.before.png
 * 산출: /tmp/tplaudit/out/patch/
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const AUDIT = '/tmp/tplaudit'
const OUT = `${AUDIT}/out`
const PATCH = `${OUT}/patch`
const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public')
const PAD = 2 // 지우기 패딩(px)
const RING = 4 // 샘플 링 두께(px)
const FULL_LOGO_RATIO = 0.5
// 사용자 결정: 로고만 있거나 로고가 전체인 블록은 패치하지 않고 삭제한다(op delete)
const DELETE_BLOCKS = new Set([
  '[F&B] 베이커리 + 사진 강조형#9',
  '[일반모집] 독서모임#0',
  '[생산/제조] 트렌디+블랙#11',
])
// 호텔 사진 2개 → 안내 그림 교체 / 깨진 안내 그림(SVG 가 .png 로 저장됨) 9개 → PNG 재렌더
const GUIDE_SVG = `${AUDIT}/dl/samples_80_img-1.png.svg`
const HOTEL_PHOTOS = ['samples/120/img-1.png', 'samples/142/img-1.png']
const BROKEN_GUIDES = [
  '78/img-7',
  '79/img-12',
  '80/img-1',
  '80/img-10',
  '82/img-5',
  '82/img-10',
  '82/img-11',
  '84/img-1',
  '84/img-12',
].map((p) => `samples/${p}.png`)
const PNG_BASE = 'https://duyteczbadcuvfeawlzu.supabase.co/storage/v1/object/public/hiring-assets/'
const OVERLAP_RATIO = 0.31 // 안 바뀐 텍스트가 지워지는 bbox 와 겹치는 비율(작은 쪽 면적 대비). 경험값: 0.08~0.30 은 줄 박스만 겹치고 글자 잉크는 안 겹치는 사례, Bakery 만 0.32 로 잉크가 겹침

type El = Record<string, any>
type Block = {
  templateId: string
  templateName: string
  order: number
  contentId: string
  title: string
  imagePath: string
  orig: any
  clean: any
}
type Op =
  | {
      kind: 'erase'
      id: string
      why: string
      x: number
      y: number
      w: number
      h: number
      fgColor?: string
      fgLogo?: string
    } // px 좌표(패딩 전). fg* 는 마스킹 지우기용 전경색(텍스트색/로고 파일)
  | {
      kind: 'text'
      id: string
      x: number
      y: number
      w: number
      text: string
      px: number
      lineH: number
      weight: number
      color: string
      align: string
      opacity: number
    }

// jsonb 는 키 순서를 보장하지 않으므로 키 정렬(canonical) 후 해시한다(apply.ts 와 동일 규칙)
const canon = (o: any): any =>
  Array.isArray(o)
    ? o.map(canon)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.keys(o)
            .sort()
            .map((k) => [k, canon(o[k])])
        )
      : o
const sha = (o: any) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canon(o)) ?? 'undefined')
    .digest('hex')

function loadBlocks(): Block[] {
  const out: Block[] = []
  for (const f of fs
    .readdirSync(AUDIT)
    .filter((f) => /^cm.*\.json$/.test(f))
    .sort()) {
    const d = JSON.parse(fs.readFileSync(`${AUDIT}/${f}`, 'utf8'))
    for (const c of d.contents) {
      const sp = `${OUT}/scenes/${c.id}.json`
      if (c.contentType !== 'design' || !fs.existsSync(sp)) continue
      out.push({
        templateId: d.meta.id,
        templateName: d.meta.name,
        order: c.sortOrder,
        contentId: c.id,
        title: c.title,
        imagePath: c.imagePath,
        orig: c.data,
        clean: JSON.parse(fs.readFileSync(sp, 'utf8')),
      })
    }
  }
  return out
}

// fontWeight 기준(≤400 Regular(300 포함), 500·600 Medium, ≥700 Bold). opening 전용 디스플레이 서체(fontFamily 2)는 fontWeight 400 이어도 굵게 렌더됐으므로 Bold 하한
function weightOf(e: El): number {
  const w =
    typeof e.fontWeight === 'number'
      ? e.fontWeight <= 400
        ? 400
        : e.fontWeight <= 600
          ? 500
          : 700
      : 400
  return Math.max(w, e.fontFamily === 2 ? 700 : 400)
}

type Rect = { x: number; y: number; w: number; h: number }
type Plan = {
  ops: Op[]
  reasons: string[]
  changed: number
  frameOk: boolean
  scale: number
  avoid: Rect[] // 격자 복사 시 원본 픽셀을 가져오면 안 되는 영역(모든 텍스트·이미지 요소 bbox)
  overlapAdded: string[] // 바뀐 요소와 bbox 가 겹쳐 함께 다시 그린 안 바뀐 텍스트 요소
}
function planBlock(b: Block, pngW: number, pngH: number): Plan {
  const els: El[] = b.orig.elements ?? []
  const frame = els.find((e) => e.type === 'frame' || e.id === 'frame')
  const reasons: string[] = []
  if (!frame)
    return {
      ops: [],
      reasons: ['no-frame'],
      changed: 0,
      frameOk: false,
      scale: 0,
      avoid: [],
      overlapAdded: [],
    }
  const scale = pngW / frame.width
  if (Math.abs(pngH / frame.height / scale - 1) > 0.01)
    reasons.push(`frame-aspect-mismatch(${pngW}x${pngH} vs ${frame.width}x${frame.height})`)
  const clean = new Map<string, El>((b.clean.elements ?? []).map((e: El) => [e.id, e]))
  const ops: Op[] = []
  let changed = 0
  const box = (e: El) => ({
    x: (e.x - frame.x) * scale,
    y: (e.y - frame.y) * scale,
    w: e.width * scale,
    h: e.height * scale,
  })
  const pushOps = (e: El, c: El | undefined, gone: boolean, bx: Rect) => {
    ops.push({
      kind: 'erase',
      id: e.id,
      why: e.type,
      ...bx,
      ...(e.type === 'text'
        ? { fgColor: e.strokeColor }
        : { fgLogo: b.orig.files?.[e.fileId]?.dataURL }),
    })
    if (e.type === 'text' && !gone && String(c!.text).trim() !== '') {
      ops.push({
        kind: 'text',
        id: e.id,
        x: bx.x,
        y: bx.y,
        w: bx.w,
        text: c!.text,
        px: e.fontSize * scale,
        lineH: e.fontSize * (e.lineHeight ?? 1.25) * scale,
        weight: weightOf(e),
        color: e.strokeColor,
        align: e.textAlign ?? 'left',
        opacity: e.opacity ?? 100,
      })
    }
  }
  for (const e of els) {
    if (e.isDeleted || e.id === frame.id) continue
    const c = clean.get(e.id)
    const gone = !c || c.isDeleted
    if (e.type === 'text') {
      if (!gone && c!.text === e.text && c!.originalText === e.originalText) continue
    } else if (!gone) continue
    else if (e.type !== 'image') continue // 정리 로직은 로고 image 만 지운다
    changed++
    if (e.angle) {
      reasons.push(`rotated:${e.id}`)
      continue
    }
    const bx = box(e)
    if (
      e.type === 'image' &&
      (e.width * e.height) / (frame.width * frame.height) >= FULL_LOGO_RATIO
    ) {
      reasons.push(`full-logo:${e.id}`)
      continue
    }
    pushOps(e, c, gone, bx)
  }
  // 겹침 규칙: 바뀐(지워지는) 요소 bbox 와 겹치는 안 바뀐 텍스트 요소도 함께 지우고 다시 그린다
  const overlapAdded: string[] = []
  const erased = () => ops.filter((o) => o.kind === 'erase')
  for (const e of els) {
    if (e.type !== 'text' || e.isDeleted || e.angle || erased().some((o) => o.id === e.id)) continue
    const c = clean.get(e.id)
    if (!c || c.isDeleted || String(c.text).trim() === '') continue
    const bx = box(e)
    const hit = erased().some((o) => {
      if (o.why !== 'text') return false // 로고(image) 와의 겹침은 대상 아님

      const iw = Math.min(o.x + o.w, bx.x + bx.w) - Math.max(o.x, bx.x)
      const ih = Math.min(o.y + o.h, bx.y + bx.h) - Math.max(o.y, bx.y)
      return iw > 0 && ih > 0 && (iw * ih) / Math.min(o.w * o.h, bx.w * bx.h) > OVERLAP_RATIO
    })
    if (!hit) continue
    pushOps(e, c, false, bx)
    overlapAdded.push(e.id)
  }
  const avoid = els
    .filter(
      (e) =>
        !e.isDeleted &&
        e.id !== frame.id &&
        (e.width * e.height) / (frame.width * frame.height) < 0.2 // 배경 격자 이미지·배경 도형 등 큰 요소는 제외(텍스트·이미지·작은 도형은 원본 픽셀 복사 금지)
    )
    .map(box)
  return { ops, reasons, changed, frameOk: true, scale, avoid, overlapAdded }
}

// ---------- 브라우저 쪽(Pretendard canvas). 직렬화되어 page.evaluate 로 실행되므로 외부 변수 참조 금지 ----------
async function browserRun(a: {
  png: string
  ops: any[]
  mode: string
  pad: number
  ring: number
  avoid?: any[]
}) {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = a.png
  })
  const W = img.naturalWidth,
    H = img.naturalHeight
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const results: { id: string; ok: boolean; reason: string }[] = []
  if (a.mode === 'coordcheck') {
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ff0000'
    for (const o of a.ops) if (o.kind === 'erase') ctx.strokeRect(o.x, o.y, o.w, o.h)
    return { png: cv.toDataURL('image/png'), results, W, H }
  }
  const src = ctx.getImageData(0, 0, W, H)
  const d = src.data
  const fills: { id: string; x0: number; y0: number; x1: number; y1: number; rgb: number[] }[] = []
  const failed = new Set<string>()
  const masks: {
    x0: number
    y0: number
    x1: number
    y1: number
    bg: number[]
    fg: number[][]
    n: number
  }[] = []
  const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  // ---- 격자 보존: 행/열 밝기 프로파일(중앙값, 텍스트에 강건)의 자기상관으로 격자 주기를 찾는다 ----
  const grid: { det?: { px: number; py: number } | null } = {}
  const periodOf = (prof: number[]) => {
    const n = prof.length
    // 고역 통과: 넓은 도형·배경 밝기 변화를 빼고 얇은 격자선만 남긴다(이동 평균 25px 차감)
    const v = prof.map((q, i) => {
      let sum = 0,
        cnt = 0
      for (let j = Math.max(0, i - 12); j <= Math.min(n - 1, i + 12); j++) {
        sum += prof[j]
        cnt++
      }
      return Math.max(-15, Math.min(15, q - sum / cnt)) // 글자 행 등 큰 변화는 클램프
    })
    const den = v.reduce((q, x) => q + x * x, 0)
    if (den < 1e-6) return 0
    const ac: number[] = []
    let max = 0
    for (let lag = 12; lag < Math.min(400, n / 3); lag++) {
      let sum = 0
      for (let i = 0; i + lag < n; i++) sum += v[i] * v[i + lag]
      ac[lag] = sum / ((den * (n - lag)) / n)
      if (ac[lag] > max) max = ac[lag]
    }
    if (max < 0.4) return 0
    for (let lag = 12; lag < ac.length; lag++) if (ac[lag] >= 0.9 * max) return lag // 배수보다 가장 작은 주기 우선
    return 0
  }
  const detectGrid = () => {
    if (grid.det !== undefined) return grid.det
    const lum = (x: number, y: number) => {
      const k = (y * W + x) * 4
      return 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]
    }
    const med = (arr: number[]) => arr.sort((p, q) => p - q)[arr.length >> 1]
    const colProf: number[] = []
    for (let x = 0; x < W; x++) {
      const col: number[] = []
      for (let y = 0; y < H; y += 4) col.push(lum(x, y))
      colProf.push(med(col))
    }
    const rowProf: number[] = []
    for (let y = 0; y < H; y++) {
      const row: number[] = []
      for (let x = 0; x < W; x += 4) row.push(lum(x, y))
      rowProf.push(med(row))
    }
    const px = periodOf(colProf),
      py = periodOf(rowProf)
    grid.det = px && py ? { px, py } : null
    return grid.det
  }
  const avoidRects = () => [
    ...(a.avoid ?? []).map((r: any) => [r.x - 2, r.y - 2, r.x + r.w + 2, r.y + r.h + 2]),
    ...a.ops
      .filter((o: any) => o.kind === 'erase')
      .map((o: any) => [
        o.x - a.pad - 2,
        o.y - a.pad - 2,
        o.x + o.w + a.pad + 2,
        o.y + o.h + a.pad + 2,
      ]),
  ]
  // 지울 픽셀을 격자 주기의 정수배만큼 떨어진(지울 영역·다른 요소 bbox 밖) 원본 픽셀에서 복사
  const gridCopies: { k: number; sk: number }[] = []
  const gridCopy = (x0: number, y0: number, x1: number, y1: number) => {
    const g = detectGrid()
    if (!g) return 'no-grid'
    const rects = avoidRects()
    const offs: number[][] = []
    for (let i = -16; i <= 16; i++)
      for (let j = -16; j <= 16; j++) if (i || j) offs.push([i * g.px, j * g.py])
    offs.sort((p, q) => Math.abs(p[0]) + Math.abs(p[1]) - (Math.abs(q[0]) + Math.abs(q[1])))
    const out: { k: number; sk: number }[] = []
    let miss = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        let found = -1
        for (const [ox, oy] of offs) {
          const sx = x + ox,
            sy = y + oy
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
          if (rects.some((r: number[]) => sx >= r[0] && sx < r[2] && sy >= r[1] && sy < r[3]))
            continue
          found = (sy * W + sx) * 4
          break
        }
        if (found < 0) miss++
        else out.push({ k: (y * W + x) * 4, sk: found })
      }
    if (miss / ((x1 - x0) * (y1 - y0)) > 0.01)
      return `grid-miss(${((100 * miss) / ((x1 - x0) * (y1 - y0))).toFixed(1)}%)`
    for (const o2 of out) gridCopies.push(o2)
    return g
  }
  // 마스킹 지우기: bbox 최빈 배경색 bg 를 잡고, bg↔전경색 선분에 가까운 픽셀만 bg 로 바꾼다(다른 색 보존)
  const maskErase = async (o: any, x0: number, y0: number, x1: number, y1: number) => {
    let fg: number[][] = []
    if (o.fgColor) {
      const t = document.createElement('canvas')
      t.width = t.height = 1
      const tc = t.getContext('2d')!
      tc.fillStyle = o.fgColor
      tc.fillRect(0, 0, 1, 1)
      const q = tc.getImageData(0, 0, 1, 1).data
      if (q[3] < 200) return 'mask-fg-transparent'
      fg = [[q[0], q[1], q[2]]]
    } else if (o.fgLogo) {
      const li = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = o.fgLogo
      })
      const t = document.createElement('canvas')
      t.width = li.naturalWidth
      t.height = li.naturalHeight
      const tc = t.getContext('2d', { willReadFrequently: true })!
      tc.drawImage(li, 0, 0)
      const q = tc.getImageData(0, 0, t.width, t.height).data
      const bins = new Map<number, { n: number; s: number[] }>()
      let tot = 0
      for (let k = 0; k < q.length; k += 4) {
        if (q[k + 3] < 200) continue
        const key = ((q[k] >> 3) << 10) | ((q[k + 1] >> 3) << 5) | (q[k + 2] >> 3)
        const b = bins.get(key) ?? { n: 0, s: [0, 0, 0] }
        b.n++
        b.s[0] += q[k]
        b.s[1] += q[k + 1]
        b.s[2] += q[k + 2]
        bins.set(key, b)
        tot++
      }
      let cov = 0
      for (const b of [...bins.values()].sort((p, q2) => q2.n - p.n).slice(0, 5)) {
        if (cov >= 0.99 * tot) break
        fg.push(b.s.map((v) => v / b.n))
        cov += b.n
      }
    }
    if (!fg.length) return 'mask-no-fg'
    const bins = new Map<number, { n: number; s: number[] }>()
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = (y * W + x) * 4
        const p = [d[k], d[k + 1], d[k + 2]]
        if (fg.some((f) => dist(p, f) <= 40)) continue
        const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3)
        const b = bins.get(key) ?? { n: 0, s: [0, 0, 0] }
        b.n++
        b.s[0] += p[0]
        b.s[1] += p[1]
        b.s[2] += p[2]
        bins.set(key, b)
      }
    const top = [...bins.values()].sort((p, q2) => q2.n - p.n)[0]
    if (!top) return 'mask-no-bg'
    const bg = top.s.map((v) => v / top.n)
    if (fg.some((f) => dist(bg, f) < 60)) return 'mask-low-contrast'
    return { x0, y0, x1, y1, bg, fg, n: 0 }
  }
  for (const o of a.ops) {
    if (o.kind !== 'erase') continue
    const x0 = Math.max(0, Math.floor(o.x - a.pad)),
      y0 = Math.max(0, Math.floor(o.y - a.pad))
    const x1 = Math.min(W, Math.ceil(o.x + o.w + a.pad)),
      y1 = Math.min(H, Math.ceil(o.y + o.h + a.pad))
    const ox0 = Math.max(0, x0 - a.ring),
      oy0 = Math.max(0, y0 - a.ring),
      ox1 = Math.min(W, x1 + a.ring),
      oy1 = Math.min(H, y1 + a.ring)
    // 격자 배경이 검출되면 링 균일 여부와 무관하게 격자 복사 우선(옅은 격자선이 단색 채우기로 지워지는 것 방지)
    const g0 = x1 > x0 && y1 > y0 ? gridCopy(x0, y0, x1, y1) : null
    if (g0 && typeof g0 === 'object') {
      results.push({ id: o.id, ok: true, reason: `grid-copy(${g0.px}x${g0.py})` })
      continue
    }
    const px: number[][] = []
    for (let y = oy0; y < oy1; y++)
      for (let x = ox0; x < ox1; x++) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) continue
        const k = (y * W + x) * 4
        px.push([d[k], d[k + 1], d[k + 2]])
      }
    if (x1 <= x0 || y1 <= y0 || px.length < 8) {
      failed.add(o.id)
      results.push({ id: o.id, ok: false, reason: 'ring-empty' })
      continue
    }
    const med = [0, 1, 2].map((c) => {
      const v = px.map((p) => p[c]).sort((p, q) => p - q)
      return v[v.length >> 1]
    })
    const std = [0, 1, 2].map((c) => {
      const m = px.reduce((s, p) => s + p[c], 0) / px.length
      return Math.sqrt(px.reduce((s, p) => s + (p[c] - m) ** 2, 0) / px.length)
    })
    const near =
      px.filter(
        (p) =>
          Math.max(Math.abs(p[0] - med[0]), Math.abs(p[1] - med[1]), Math.abs(p[2] - med[2])) <= 24
      ).length / px.length
    if (Math.max(...std) > 12 || near < 0.85) {
      const why = `ring-nonuniform(std ${Math.max(...std).toFixed(1)}, near ${near.toFixed(2)})`
      const g = g0
      const m = await maskErase(o, x0, y0, x1, y1)
      if (typeof m === 'string') {
        failed.add(o.id)
        results.push({ id: o.id, ok: false, reason: `${why}→${m}` })
        continue
      }
      masks.push(m)
      results.push({ id: o.id, ok: true, reason: `masked(${m.n}px)[${g}]` })
      continue
    }
    fills.push({ id: o.id, x0, y0, x1, y1, rgb: med })
    results.push({ id: o.id, ok: true, reason: 'erased' })
  }
  for (const f of fills) {
    ctx.fillStyle = `rgb(${f.rgb[0]},${f.rgb[1]},${f.rgb[2]})`
    ctx.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0)
  }
  if (masks.length || gridCopies.length) {
    const cur = ctx.getImageData(0, 0, W, H)
    const c = cur.data
    for (const gc of gridCopies) {
      c[gc.k] = d[gc.sk]
      c[gc.k + 1] = d[gc.sk + 1]
      c[gc.k + 2] = d[gc.sk + 2]
      c[gc.k + 3] = 255
    }
    for (const m of masks) {
      for (let y = m.y0; y < m.y1; y++)
        for (let x = m.x0; x < m.x1; x++) {
          const k = (y * W + x) * 4
          const p = [d[k], d[k + 1], d[k + 2]]
          let hit = false
          for (const f of m.fg) {
            const v = [f[0] - m.bg[0], f[1] - m.bg[1], f[2] - m.bg[2]]
            const t = Math.max(
              0,
              Math.min(
                1,
                ((p[0] - m.bg[0]) * v[0] + (p[1] - m.bg[1]) * v[1] + (p[2] - m.bg[2]) * v[2]) /
                  (v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
              )
            )
            if (dist(p, [m.bg[0] + t * v[0], m.bg[1] + t * v[1], m.bg[2] + t * v[2]]) <= 16) {
              hit = true
              break
            }
          }
          if (hit) {
            c[k] = m.bg[0]
            c[k + 1] = m.bg[1]
            c[k + 2] = m.bg[2]
            c[k + 3] = 255
            m.n++
          }
        }
    }
    ctx.putImageData(cur, 0, 0)
    for (const r of results) {
      const m = r.reason.startsWith('masked(') ? masks.shift() : null
      if (m) r.reason = r.reason.replace(/^masked\(\d+px\)/, `masked(${m.n}px)`)
    }
  }
  const need = new Set<number>(a.ops.filter((o) => o.kind === 'text').map((o) => o.weight))
  for (const w of need) await document.fonts.load(`${w} 20px Pretendard`, '가A1')
  for (const o of a.ops) {
    if (o.kind !== 'text' || failed.has(o.id)) continue
    ctx.font = `${o.weight} ${o.px}px Pretendard`
    ctx.fillStyle = o.color
    ctx.globalAlpha = o.opacity / 100
    ctx.textAlign = o.align as CanvasTextAlign
    ctx.textBaseline = 'alphabetic'
    const m = ctx.measureText('가')
    const asc = m.fontBoundingBoxAscent,
      desc = m.fontBoundingBoxDescent
    const tx = o.align === 'center' ? o.x + o.w / 2 : o.align === 'right' ? o.x + o.w : o.x
    ;(o.text as string).split('\n').forEach((line: string, i: number) => {
      ctx.fillText(line, tx, o.y + i * o.lineH + (o.lineH - (asc + desc)) / 2 + asc)
    })
    ctx.globalAlpha = 1
  }
  return { png: cv.toDataURL('image/png'), results, W, H }
}

// SVG(base64) → 흰 배경 PNG. 가로 width, 세로는 SVG 비율(직렬화되어 실행되므로 외부 변수 참조 금지)
async function browserSvg(a: { svg: string; width: number }) {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = `data:image/svg+xml;base64,${a.svg}`
  })
  const h = Math.round((a.width * img.naturalHeight) / img.naturalWidth)
  const cv = document.createElement('canvas')
  cv.width = a.width
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, a.width, h)
  ctx.drawImage(img, 0, 0, a.width, h)
  return cv.toDataURL('image/png')
}

async function withBrowser<T>(fn: (page: any) => Promise<T>): Promise<T> {
  const { chromium } = createRequire('/tmp/pwtool/package.json')('playwright-core')
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (u === '/blank.html') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><meta charset="utf-8">')
      return
    }
    const file = path.join(PUBLIC_DIR, u)
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end()
      return
    }
    fs.readFile(file, (err, buf) =>
      err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': 'font/woff2' }).end(buf)
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port
  const browser = await chromium.launch({
    executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    page.on('pageerror', (e: Error) => console.error('pageerror', e.message))
    await page.goto(`http://127.0.0.1:${port}/blank.html`)
    // @font-face 전체 unicode(unicode-range 없음)
    await page.evaluate(async () => {
      for (const [w, n] of [
        [400, 'Regular'],
        [500, 'Medium'],
        [700, 'Bold'],
      ] as const) {
        const f = new FontFace('Pretendard', `url(/fonts/hiring/Pretendard-${n}.woff2)`, {
          weight: String(w),
        })
        document.fonts.add(await f.load())
      }
    })
    return await fn(page)
  } finally {
    await browser.close()
    server.close()
  }
}

const dataUrl = (f: string) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`
const pngSize = (f: string) => {
  const b = fs.readFileSync(f)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const save = (url: string, f: string) =>
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'))

async function modeCoordcheck() {
  fs.mkdirSync(PATCH, { recursive: true })
  const blocks = loadBlocks()
  const plans = blocks.map((b) => ({
    b,
    p: planBlock(
      b,
      pngSize(`${OUT}/png/${b.contentId}.before.png`).w,
      pngSize(`${OUT}/png/${b.contentId}.before.png`).h
    ),
  }))
  const generic = plans.find(
    (x) => x.b.templateName === '[기본] 급여 강조 공고' && x.b.order === 0
  )!
  const cover = plans.find((x) => x.b.templateName === '[물류] 급여강조형' && x.b.order === 0)!
  // pill: 바뀐 텍스트 bbox 가 둥근 사각형(프레임 대비 60% 미만) 안에 들어가는 블록
  const pill = plans.find(({ b, p }) => {
    if (!p.frameOk) return false
    const els: El[] = b.orig.elements
    const fr = els.find((e) => e.type === 'frame' || e.id === 'frame')!
    return p.ops.some(
      (o) =>
        o.kind === 'text' &&
        els.some(
          (s) =>
            s.type === 'rectangle' &&
            s.roundness &&
            !s.isDeleted &&
            s.width < fr.width * 0.95 &&
            s.height < fr.height * 0.5 &&
            s.id !== b.orig.elements[0].id &&
            (() => {
              const e = els.find((q) => q.id === o.id)!
              return (
                e.x >= s.x - 1 &&
                e.y >= s.y - 1 &&
                e.x + e.width <= s.x + s.width + 1 &&
                e.y + e.height <= s.y + s.height + 1
              )
            })()
        )
    )
  })
  await withBrowser(async (page) => {
    for (const [name, x] of (
      [
        ['generic', generic],
        ['cover', cover],
        ['pill', pill],
      ] as const
    ).filter((t) => t[1])) {
      const r = await page.evaluate(browserRun, {
        png: dataUrl(`${OUT}/png/${x!.b.contentId}.before.png`),
        ops: x!.p.ops,
        mode: 'coordcheck',
        pad: PAD,
        ring: RING,
      })
      const f = `${PATCH}/coordcheck-${name}.png`
      save(r.png, f)
      console.log(
        `coordcheck ${name}: ${x!.b.templateName} #${x!.b.order} ${x!.b.contentId} ops ${x!.p.ops.length} -> ${f}`
      )
    }
  })
}

async function modePatch() {
  fs.mkdirSync(`${PATCH}/sheets`, { recursive: true })
  const blocks = loadBlocks()
  const manifest: any[] = []
  const report: string[] = [
    '# patch 리포트\n',
    '| 템플릿 | #순서 제목 | contentId | 변경 요소 | 상태/사유 | 크기 동일 | after base64 길이 |',
    '|---|---|---|---|---|---|---|',
  ]
  const rows: { label: string; before: string; after: string; status: string; masked?: boolean }[] =
    []
  await withBrowser(async (page) => {
    for (const b of blocks) {
      const bf = `${OUT}/png/${b.contentId}.before.png`
      const sz = pngSize(bf)
      const plan = planBlock(b, sz.w, sz.h)
      const reasons = [...plan.reasons]
      let afterUrl = dataUrl(bf)
      const notes: string[] = []
      let patched = 0,
        maskedN = 0
      if (plan.frameOk && !reasons.some((r) => r.startsWith('full-logo'))) {
        const r = await page.evaluate(browserRun, {
          png: afterUrl,
          ops: plan.ops,
          mode: 'patch',
          pad: PAD,
          ring: RING,
          avoid: plan.avoid,
        })
        afterUrl = r.png
        notes.push(...r.results.map((x: any) => `${x.id}:${x.reason}`))
        for (const x of r.results) {
          if (x.ok) patched++
          else reasons.push(`${x.reason}:${x.id}`)
          if (x.reason.startsWith('masked(') || x.reason.startsWith('grid-copy')) maskedN++
        }
      }
      const af = `${PATCH}/${b.contentId}.after.png`
      save(afterUrl, af)
      const asz = pngSize(af)
      const status = reasons.length ? 'review' : maskedN ? 'auto-masked' : 'auto'
      const sameSize = asz.w === sz.w && asz.h === sz.h
      const del = DELETE_BLOCKS.has(`${b.templateName}#${b.order}`)
      manifest.push({
        op: del ? 'delete' : 'patch',
        contentId: b.contentId,
        templateId: b.templateId,
        templateName: b.templateName,
        order: b.order,
        title: b.title,
        contentType: 'design',
        scenePath: `${OUT}/scenes/${b.contentId}.json`,
        overlapAdded: plan.overlapAdded,
        notes,
        originalDataSha256: sha(b.orig),
        sanitizedDataSha256: sha(b.clean),
        originalImagePath: b.imagePath,
        afterPng: af,
        status: del ? 'auto' : status,
        reasons: del ? [] : reasons,
      })
      report.push(
        `| ${b.templateName} | #${b.order} ${b.title} | ${b.contentId} | ${plan.changed} (패치 ${patched}) | ${status}${reasons.length ? ': ' + reasons.join(', ') : ''} | ${sameSize ? 'O' : 'X'} ${sz.w}x${sz.h}→${asz.w}x${asz.h} | ${afterUrl.length - afterUrl.indexOf(',') - 1} |`
      )
      rows.push({
        label: `${b.templateName} · #${b.order} ${b.title} · ${b.contentId}`,
        before: dataUrl(bf),
        after: afterUrl,
        status: `${status}${reasons.length ? ' ' + reasons.join(', ') : ''}`,
        masked: maskedN > 0 || reasons.some((r) => r.includes('→mask')),
      })
      console.log(
        `${status} ${b.contentId} ${b.templateName} #${b.order}${reasons.length ? ' ' + reasons.join(', ') : ''}`
      )
    }
    // ---- image 블록: 호텔 사진 교체 + 깨진 안내 그림 재렌더 ----
    const imgRows: typeof rows = []
    const audits = fs
      .readdirSync(AUDIT)
      .filter((f) => /^cm.*\.json$/.test(f))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(`${AUDIT}/${f}`, 'utf8')))
    const sizeOf = async (url: string) =>
      (await page.evaluate(
        (u: string) =>
          new Promise<number>((res, rej) => {
            const i = new Image()
            i.onload = () => res(i.naturalWidth)
            i.onerror = rej
            i.src = u
          }),
        url
      )) as number
    for (const t of audits)
      for (const c of t.contents) {
        if (c.contentType !== 'image') continue
        const hotel = HOTEL_PHOTOS.includes(c.imagePath)
        const broken = BROKEN_GUIDES.includes(c.imagePath)
        if (!hotel && !broken) continue
        const key = c.imagePath.replace(/\//g, '_')
        let width = 2880 // SVG viewBox(1440x805) 2배
        let beforeUrl: string
        if (hotel) {
          const bf = `${OUT}/imgsrc/${key}`
          if (!fs.existsSync(bf))
            fs.writeFileSync(
              bf,
              Buffer.from(await (await fetch(PNG_BASE + c.imagePath)).arrayBuffer())
            )
          const buf = fs.readFileSync(bf)
          beforeUrl = `data:${buf[0] === 0xff ? 'image/jpeg' : 'image/png'};base64,${buf.toString('base64')}`
          width = await sizeOf(beforeUrl) // 원본 사진과 같은 가로 크기
        } else {
          beforeUrl = `data:image/svg+xml;base64,${fs.readFileSync(`${AUDIT}/dl/samples_${c.imagePath.slice(8).replace('/', '_')}.svg`).toString('base64')}`
        }
        const svgFile = hotel
          ? GUIDE_SVG
          : `${AUDIT}/dl/samples_${c.imagePath.slice(8).replace('/', '_')}.svg`
        const png = await page.evaluate(browserSvg, {
          svg: fs.readFileSync(svgFile).toString('base64'),
          width,
        })
        const af = `${PATCH}/${c.id}.after.png`
        save(png, af)
        const asz = pngSize(af)
        manifest.push({
          op: 'image',
          contentId: c.id,
          templateId: t.meta.id,
          templateName: t.meta.name,
          order: c.sortOrder,
          title: c.title,
          contentType: 'image',
          originalDataSha256: sha(c.data),
          sanitizedDataSha256: sha(c.data),
          originalImagePath: c.imagePath,
          afterPng: af,
          status: 'auto',
          reasons: [],
        })
        report.push(
          `| ${t.meta.name} | #${c.sortOrder} (image) ${c.title ?? ''} | ${c.id} | image ${hotel ? '사진→안내그림' : 'SVG→PNG'} | auto | ${asz.w}x${asz.h} | ${png.length - png.indexOf(',') - 1} |`
        )
        imgRows.push({
          label: `${t.meta.name} · #${c.sortOrder} image · ${c.imagePath}`,
          before: beforeUrl,
          after: png,
          status: `image ${asz.w}x${asz.h}`,
        })
      }
    // ---- 커버: 템플릿별 (삭제 제외) sortOrder 최소 이미지 블록의 반영 후 imagePath 로 apply 단계에서 PATCH ----
    const deleted = new Set(manifest.filter((m) => m.op === 'delete').map((m) => m.contentId))
    for (const t of audits) {
      const first = [...t.contents]
        .filter((c: any) => !deleted.has(c.id) && c.imagePath)
        .sort((p: any, q: any) => p.sortOrder - q.sortOrder)[0]
      manifest.push({
        op: 'cover',
        templateId: t.meta.id,
        templateName: t.meta.name,
        originalImagePath: t.meta.imagePath,
        sourceContentId: first?.id ?? null,
        status: first ? 'auto' : 'review',
        reasons: first ? [] : ['no-source-block'],
      })
    }
    const writeSheets = async (list: typeof rows, prefix: string, per: number) => {
      for (let i = 0; i * per < list.length; i++) {
        const html =
          `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:12px sans-serif;width:1200px}.r{display:flex;gap:8px;padding:6px;border-bottom:2px solid #333}.c{width:580px}.c img{width:580px;border:1px solid #ccc;display:block}.l{font-weight:bold;padding:4px 6px;background:#eee}</style>` +
          list
            .slice(i * per, (i + 1) * per)
            .map(
              (r) =>
                `<div class="l">${r.label} — ${r.status}</div><div class="r"><div class="c">before<img src="${r.before}"></div><div class="c">after<img src="${r.after}"></div></div>`
            )
            .join('')
        const f = `${PATCH}/sheets/${prefix}${String(i).padStart(2, '0')}`
        fs.writeFileSync(`${f}.html`, html)
        await page.goto(`file://${f}.html`)
        await page.waitForLoadState('load')
        await page.screenshot({ path: `${f}.png`, fullPage: true })
      }
    }
    await writeSheets(rows, 'sheet-', 4)
    await writeSheets(imgRows, 'images-', 4)
    await writeSheets(
      rows.filter((r) => r.masked),
      'masked-',
      3
    ) // 마스킹 지우기 시도 블록(성공·실패 모두)
  })
  const opCount = (op: string) => manifest.filter((m) => m.op === op).length
  report.push(
    `\nops: patch ${opCount('patch')} / delete ${opCount('delete')} / image ${opCount('image')} / cover ${opCount('cover')} — status auto ${manifest.filter((m) => m.status === 'auto').length} / auto-masked ${manifest.filter((m) => m.status === 'auto-masked').length} / review ${manifest.filter((m) => m.status === 'review').length}`
  )
  fs.writeFileSync(`${PATCH}/report.md`, report.join('\n'))
  fs.writeFileSync(`${PATCH}/manifest.json`, JSON.stringify(manifest, null, 2))
  console.log(
    `ops: patch ${opCount('patch')} / delete ${opCount('delete')} / image ${opCount('image')} / cover ${opCount('cover')} — status auto ${manifest.filter((m) => m.status === 'auto').length} / auto-masked ${manifest.filter((m) => m.status === 'auto-masked').length} / review ${manifest.filter((m) => m.status === 'review').length}`
  )
}

const mode = process.argv[2]
if (mode === 'coordcheck') await modeCoordcheck()
else if (mode === 'patch') await modePatch()
else {
  console.error('usage: patch.ts coordcheck|patch')
  process.exit(1)
}
