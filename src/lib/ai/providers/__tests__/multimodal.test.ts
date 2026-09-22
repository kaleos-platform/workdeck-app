/** @jest-environment node */
import { OpenAiProvider } from '../text-openai'

describe('상품 상세 이미지 전달', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('이미지 바이트를 텍스트와 함께 전달하고 텍스트 전용 요청을 보존한다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    })
    global.fetch = fetchMock
    const provider = new OpenAiProvider({ apiKey: 'test' })
    await provider.generate({
      messages: [
        {
          role: 'user',
          content: '소재 확인',
          images: [{ mimeType: 'image/jpeg', data: 'aW1hZ2U=' }],
        },
      ],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '소재 확인' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aW1hZ2U=', detail: 'high' } },
    ])
    await provider.generate({ messages: [{ role: 'user', content: '텍스트만' }] })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toBe('텍스트만')
  })
})
