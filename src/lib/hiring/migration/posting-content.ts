export type ContentJson =
  | null
  | boolean
  | number
  | string
  | ContentJson[]
  | { [key: string]: ContentJson }
export type VerifiedContentImage = {
  copiedImagePath: string
  verified: boolean
  sha256?: string
  sizeBytes?: number
}
export type PreparedContentResource = VerifiedContentImage & {
  hasSceneSource: boolean
  sourceImageKey?: string
  scene?: unknown
}
export type PostingContentInput = {
  detail: unknown
  detailImage?: VerifiedContentImage
  postingTitle?: string
  companyIntro?: string
  positionsVerified?: boolean
  positionConditionsText?: string
  storesText?: string
  managerText?: string
  originalApplyUrl: string
  resources: Record<string, PreparedContentResource>
  // UUID가 없거나 중복인 경우 원본 배열 index로 occurrence를 구별한다.
  images: Record<string, VerifiedContentImage>
}
export type PlannedContentBlock = {
  contentType: 'text' | 'positions' | 'design' | 'image'
  data: ContentJson
  imagePath: string | null
  title: string | null
  sortOrder: number
}
export type PostingContentFailureCode =
  | 'invalid_detail'
  | 'invalid_section'
  | 'unsupported_section'
  | 'unsupported_attribute'
  | 'missing_dynamic_text'
  | 'unverified_positions'
  | 'invalid_resource_id'
  | 'missing_resource'
  | 'missing_image'
  | 'ambiguous_image'
  | 'image_source_mismatch'
  | 'unverified_image'
  | 'invalid_image_path'
  | 'missing_scene'
  | 'invalid_scene'
  | 'invalid_link'
export type PostingContentResult =
  | { ok: true; blocks: PlannedContentBlock[]; excludedDisabled: number[] }
  | { ok: false; code: PostingContentFailureCode; index?: number }

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const supported = [
  'posting_title',
  'company_intro',
  'posting_positions',
  'custom',
  'posting_stores',
  'manager',
  'content',
  'content_link',
  'image',
]
const attributes = new Set([
  'type',
  'enabled',
  'uuid',
  'resource_id',
  'name',
  'url',
  'image_key',
  'file_key',
  'image_url',
  'image_download_url',
  'items',
])
const paragraph = (text: string): ContentJson => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})
const paragraphs = (text: string): ContentJson[] => text.split(/\r\n|\r|\n/).map(paragraph)
const heading = (text: string): ContentJson => ({
  type: 'heading',
  attrs: { level: 2 },
  content: text ? [{ type: 'text', text }] : [],
})
const doc = (content: ContentJson[]): ContentJson => ({ type: 'doc', content })
function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || !/^https?:\/\//i.test(value))
    return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
function resourceId(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null
}
function json(value: unknown, seen = new Set<object>()): value is ContentJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const valid = (Array.isArray(value) ? value : Object.values(value)).every((v) => json(v, seen))
  seen.delete(value)
  return valid
}
function validScene(scene: unknown): scene is Record<string, ContentJson> {
  if (!record(scene) || !Array.isArray(scene.elements) || !record(scene.files) || !json(scene))
    return false
  const files = scene.files
  if (
    !Object.values(files).every(
      (file) =>
        record(file) &&
        typeof file.dataURL === 'string' &&
        /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(file.dataURL)
    )
  )
    return false
  return scene.elements.every((element) => {
    if (!record(element) || typeof element.type !== 'string') return false
    if (element.type !== 'image' || element.isDeleted === true) return true
    if (typeof element.fileId !== 'string' || !Object.hasOwn(files, element.fileId)) return false
    return true
  })
}

function validateImage(asset: VerifiedContentImage | undefined): PostingContentFailureCode | null {
  if (!asset || typeof asset.copiedImagePath !== 'string' || !asset.copiedImagePath.trim())
    return 'missing_image'
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(asset.copiedImagePath) ||
    asset.copiedImagePath.split('/').some((part) => part === '.' || part === '..')
  )
    return 'invalid_image_path'
  if (asset.verified !== true) return 'unverified_image'
  return null
}

// 네트워크/DB 접근 없이 이미 준비하고 검증한 원본 snapshot만 변환한다.
export function planPostingContent(input: PostingContentInput): PostingContentResult {
  if (!Array.isArray(input.detail)) return { ok: false, code: 'invalid_detail' }
  const imageUuidCounts = new Map<string, number>()
  for (const section of input.detail) {
    if (record(section) && section.type === 'image' && typeof section.uuid === 'string') {
      imageUuidCounts.set(section.uuid, (imageUuidCounts.get(section.uuid) ?? 0) + 1)
    }
  }
  const blocks: PlannedContentBlock[] = []
  const excludedDisabled: number[] = []
  if (input.detailImage !== undefined) {
    const imageFailure = validateImage(input.detailImage)
    if (imageFailure) return { ok: false, code: imageFailure }
    blocks.push({
      contentType: 'image',
      data: { link: { linkType: 'none' } },
      imagePath: input.detailImage.copiedImagePath,
      title: null,
      sortOrder: 0,
    })
  }
  for (const [index, section] of input.detail.entries()) {
    const fail = (code: PostingContentFailureCode): PostingContentResult => ({
      ok: false,
      code,
      index,
    })
    if (!record(section) || (section.enabled !== undefined && typeof section.enabled !== 'boolean'))
      return fail('invalid_section')
    if (!section.enabled) {
      excludedDisabled.push(index)
      continue
    }
    if (typeof section.type !== 'string' || !supported.includes(section.type))
      return fail('unsupported_section')
    if (Object.keys(section).some((key) => !attributes.has(key)))
      return fail('unsupported_attribute')
    // 원본은 복사 시 저장한 section.file_key를 읽지 않고 resource의 최신 scene을 편집한다.
    if (section.file_key !== undefined && typeof section.file_key !== 'string')
      return fail('invalid_section')
    if (section.name !== undefined && typeof section.name !== 'string')
      return fail('invalid_section')
    if (section.uuid !== undefined && typeof section.uuid !== 'string')
      return fail('invalid_section')
    const title = typeof section.name === 'string' ? section.name : null
    const add = (
      contentType: PlannedContentBlock['contentType'],
      data: ContentJson,
      imagePath: string | null = null
    ) => blocks.push({ contentType, data, imagePath, title, sortOrder: blocks.length })
    if (section.type === 'posting_positions') {
      if (input.positionsVerified !== true) return fail('unverified_positions')
      add('positions', null)
      if (input.positionConditionsText !== undefined) {
        if (typeof input.positionConditionsText !== 'string') return fail('missing_dynamic_text')
        if (input.positionConditionsText) add('text', doc(paragraphs(input.positionConditionsText)))
      }
      continue
    }
    const dynamic = {
      posting_title: input.postingTitle,
      company_intro: input.companyIntro,
      posting_stores: input.storesText,
      manager: input.managerText,
    }
    if (Object.hasOwn(dynamic, section.type)) {
      const text = dynamic[section.type as keyof typeof dynamic]
      if (typeof text !== 'string') return fail('missing_dynamic_text')
      add('text', doc(section.type === 'posting_title' ? [heading(text)] : paragraphs(text)))
      continue
    }
    if (section.type === 'custom') {
      if (!Array.isArray(section.items)) return fail('invalid_section')
      const nodes: ContentJson[] = []
      for (const item of section.items) {
        if (!record(item) || typeof item.label !== 'string' || typeof item.value !== 'string')
          return fail('invalid_section')
        if (Object.keys(item).some((key) => key !== 'label' && key !== 'value'))
          return fail('unsupported_attribute')
        if (item.label) nodes.push(heading(item.label))
        nodes.push(...paragraphs(item.value))
      }
      add('text', doc(nodes))
      continue
    }
    let asset: VerifiedContentImage | undefined
    let resource: PreparedContentResource | undefined
    if (section.type === 'image') {
      if (
        typeof section.uuid === 'string' &&
        (imageUuidCounts.get(section.uuid) ?? 0) > 1 &&
        !input.images[`index:${index}`]
      )
        return fail('ambiguous_image')
      asset =
        input.images[`index:${index}`] ??
        (section.uuid ? input.images[`uuid:${section.uuid}`] : undefined)
    } else {
      const id = resourceId(section.resource_id)
      if (!id) return fail('invalid_resource_id')
      resource = Object.hasOwn(input.resources, id) ? input.resources[id] : undefined
      if (!resource) return fail('missing_resource')
      if (
        section.image_key !== undefined &&
        (typeof section.image_key !== 'string' || section.image_key !== resource.sourceImageKey)
      )
        return fail('image_source_mismatch')
      asset = resource
    }
    const imageFailure = validateImage(asset)
    if (imageFailure) return fail(imageFailure)
    if (!asset) return fail('missing_image')
    let data: ContentJson = { link: { linkType: 'none' } }
    let kind: 'image' | 'design' = 'image'
    if (resource) {
      if (typeof resource.hasSceneSource !== 'boolean') return fail('missing_scene')
      if (section.type === 'content' && !resource.hasSceneSource) return fail('missing_scene')
      if (resource.hasSceneSource) {
        if (resource.scene === undefined || resource.scene === null) return fail('missing_scene')
        if (!validScene(resource.scene)) return fail('invalid_scene')
        data = { ...resource.scene, link: { linkType: 'none' } }
        kind = 'design'
      }
    }
    if (section.type === 'content_link' && section.url !== undefined && section.url !== '') {
      if (!httpUrl(section.url)) return fail('invalid_link')
      const link: ContentJson =
        httpUrl(input.originalApplyUrl) && section.url === input.originalApplyUrl
          ? { linkType: 'form' }
          : { linkType: 'url', url: section.url }
      data = { ...(data as Record<string, ContentJson>), link }
    }
    add(kind, data, asset.copiedImagePath)
  }
  return { ok: true, blocks, excludedDisabled }
}
