// @jest-environment node
import { blockLinkSchema, buttonDataSchema } from '../hiring-posts'

describe('blockLinkSchema', () => {
  it("linkType 'none' 은 url 없이 통과한다", () => {
    expect(blockLinkSchema.safeParse({ linkType: 'none' }).success).toBe(true)
  })

  it("linkType 'form' 은 url 없이 통과한다", () => {
    expect(blockLinkSchema.safeParse({ linkType: 'form' }).success).toBe(true)
  })

  it("linkType 'url' + http/https 는 통과한다", () => {
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: 'https://example.com' }).success).toBe(
      true
    )
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: 'http://example.com' }).success).toBe(
      true
    )
  })

  it("linkType 'url' + 빈 url 은 거부한다", () => {
    expect(blockLinkSchema.safeParse({ linkType: 'url' }).success).toBe(false)
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: '   ' }).success).toBe(false)
  })

  it('javascript: 등 비 http(s) 스킴은 거부한다(XSS 차단)', () => {
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: 'javascript:alert(1)' }).success).toBe(
      false
    )
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: 'data:text/html,x' }).success).toBe(
      false
    )
    expect(blockLinkSchema.safeParse({ linkType: 'url', url: 'not a url' }).success).toBe(false)
  })

  it('알 수 없는 linkType 은 거부한다', () => {
    expect(blockLinkSchema.safeParse({ linkType: 'foo' }).success).toBe(false)
  })
})

// refineHttpUrl 추출 리팩터 후에도 버튼 스키마 동작이 보존되는지 확인
describe('buttonDataSchema (리팩터 회귀)', () => {
  it('form 버튼은 url 없이 통과한다', () => {
    expect(buttonDataSchema.safeParse({ title: '지원하기', linkType: 'form' }).success).toBe(true)
  })

  it('url 버튼은 http/https 만 통과하고 javascript: 는 거부한다', () => {
    expect(
      buttonDataSchema.safeParse({ title: 'x', linkType: 'url', url: 'https://a.com' }).success
    ).toBe(true)
    expect(
      buttonDataSchema.safeParse({ title: 'x', linkType: 'url', url: 'javascript:alert(1)' })
        .success
    ).toBe(false)
    expect(buttonDataSchema.safeParse({ title: 'x', linkType: 'url' }).success).toBe(false)
  })
})
