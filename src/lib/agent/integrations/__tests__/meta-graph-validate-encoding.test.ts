/** @jest-environment node */
import { graphRequest } from '../meta-ads'

it('execution_options 는 form 본문에 JSON 배열 문자열로 실린다(Meta curl 예시와 같음)', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
  await graphRequest(
    { secret: { accessToken: 't', appSecret: 's' }, config: {} } as never,
    'POST',
    '/act_123/adsets',
    { name: 'x', execution_options: ['validate_only'] }
  )
  const body = fetchMock.mock.calls[0][1].body as URLSearchParams
  expect(body.get('execution_options')).toBe('["validate_only"]')
  expect(body.get('name')).toBe('x')
})
