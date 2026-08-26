import { productExtractApplySchema, productExtractRequestSchema, productSchema } from '../schemas'

// PATCH 라우트는 productSchema.partial() 로 파싱한다 (app/api/sh/products/[productId]/route.ts)
const patchSchema = productSchema.partial()

describe('productSchema — description clear/skip', () => {
  it('undefined 는 skip — 라우트가 `!== undefined` 로 분기하므로 값 자체가 undefined면 충분', () => {
    const r = patchSchema.parse({ description: undefined })
    expect(r.description).toBeUndefined()
  })

  it('null 은 명시적 clear', () => {
    const r = patchSchema.parse({ description: null })
    expect(r.description).toBeNull()
  })

  it('빈 문자열은 clear', () => {
    const r = patchSchema.parse({ description: '' })
    expect(r.description).toBeNull()
  })

  it('공백만 있는 문자열도 clear', () => {
    const r = patchSchema.parse({ description: '   ' })
    expect(r.description).toBeNull()
  })

  it('2001자는 실패', () => {
    const r = patchSchema.safeParse({ description: 'x'.repeat(2001) })
    expect(r.success).toBe(false)
  })

  it('2000자는 성공', () => {
    const r = patchSchema.safeParse({ description: 'x'.repeat(2000) })
    expect(r.success).toBe(true)
  })
})

describe('productSchema — features/certifications 상한', () => {
  it('features 21개는 실패', () => {
    const r = patchSchema.safeParse({ features: Array.from({ length: 21 }, (_, i) => `f${i}`) })
    expect(r.success).toBe(false)
  })

  it('features 20개는 성공', () => {
    const r = patchSchema.safeParse({ features: Array.from({ length: 20 }, (_, i) => `f${i}`) })
    expect(r.success).toBe(true)
  })

  it('features 항목 201자는 실패', () => {
    const r = patchSchema.safeParse({ features: ['x'.repeat(201)] })
    expect(r.success).toBe(false)
  })

  it('features 항목 200자는 성공', () => {
    const r = patchSchema.safeParse({ features: ['x'.repeat(200)] })
    expect(r.success).toBe(true)
  })

  it('certifications 21개는 실패', () => {
    const r = patchSchema.safeParse({
      certifications: Array.from({ length: 21 }, (_, i) => `c${i}`),
    })
    expect(r.success).toBe(false)
  })

  it('certifications 20개는 성공', () => {
    const r = patchSchema.safeParse({
      certifications: Array.from({ length: 20 }, (_, i) => `c${i}`),
    })
    expect(r.success).toBe(true)
  })

  it('certifications 항목 201자는 실패', () => {
    const r = patchSchema.safeParse({ certifications: ['x'.repeat(201)] })
    expect(r.success).toBe(false)
  })

  it('certifications 항목 200자는 성공', () => {
    const r = patchSchema.safeParse({ certifications: ['x'.repeat(200)] })
    expect(r.success).toBe(true)
  })
})

describe('productExtractRequestSchema', () => {
  it('전부 비어있으면 실패 (한국어 메시지)', () => {
    const r = productExtractRequestSchema.safeParse({})
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('소재를 1개 이상 입력해주세요')
    }
  })

  it('pastedText 만 있으면 성공', () => {
    const r = productExtractRequestSchema.safeParse({ pastedText: '상품 설명입니다' })
    expect(r.success).toBe(true)
  })

  it('파일 6개는 실패 (max 5)', () => {
    const file = {
      storagePath: 'a/b.png',
      fileName: 'b.png',
      mimeType: 'image/png',
      byteSize: 100,
    }
    const r = productExtractRequestSchema.safeParse({ files: Array(6).fill(file) })
    expect(r.success).toBe(false)
  })

  it('허용되지 않는 mimeType 은 실패', () => {
    const r = productExtractRequestSchema.safeParse({
      files: [{ storagePath: 'a/b.txt', fileName: 'b.txt', mimeType: 'text/plain', byteSize: 100 }],
    })
    expect(r.success).toBe(false)
  })

  it('byteSize 10MB 초과는 실패', () => {
    const r = productExtractRequestSchema.safeParse({
      files: [
        {
          storagePath: 'a/b.png',
          fileName: 'b.png',
          mimeType: 'image/png',
          byteSize: 10 * 1024 * 1024 + 1,
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})

describe('productExtractApplySchema', () => {
  it('빈 배열은 실패', () => {
    const r = productExtractApplySchema.safeParse({ fields: [] })
    expect(r.success).toBe(false)
  })

  it('알 수 없는 필드명은 실패', () => {
    const r = productExtractApplySchema.safeParse({ fields: ['notAField'] })
    expect(r.success).toBe(false)
  })

  it('유효한 필드명은 성공', () => {
    const r = productExtractApplySchema.safeParse({ fields: ['description', 'features'] })
    expect(r.success).toBe(true)
  })
})

describe('manufacturer / manufactureCountry clear', () => {
  // AI 추출 롤백이 이 필드들을 원래의 빈 값으로 되돌리려면 clear 가 동작해야 한다.
  const partial = productSchema.partial()

  it.each(['manufacturer', 'manufactureCountry'] as const)(
    '%s: null 은 clear 신호로 null 이 된다',
    (f) => {
      const r = partial.parse({ [f]: null }) as Record<string, unknown>
      expect(r[f]).toBeNull()
    }
  )

  it.each(['manufacturer', 'manufactureCountry'] as const)(
    '%s: 빈 문자열도 clear 로 null 이 된다',
    (f) => {
      const r = partial.parse({ [f]: '' }) as Record<string, unknown>
      expect(r[f]).toBeNull()
    }
  )

  it.each(['manufacturer', 'manufactureCountry'] as const)('%s: undefined 는 필드 skip', (f) => {
    const r = partial.parse({ [f]: undefined }) as Record<string, unknown>
    expect(r[f]).toBeUndefined()
  })

  it('manufacturer 는 200자를 넘기면 거부한다', () => {
    expect(partial.safeParse({ manufacturer: 'a'.repeat(201) }).success).toBe(false)
  })

  it('manufactureCountry 는 100자를 넘기면 거부한다', () => {
    expect(partial.safeParse({ manufactureCountry: 'a'.repeat(101) }).success).toBe(false)
  })
})
