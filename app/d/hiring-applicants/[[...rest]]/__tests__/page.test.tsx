import LegacyPage from '../page'

const redirect = jest.fn()
jest.mock('next/navigation', () => ({
  redirect: (p: string) => {
    redirect(p)
    throw new Error('NEXT_REDIRECT')
  },
}))

async function run(rest?: string[]) {
  redirect.mockClear()
  await expect(LegacyPage({ params: Promise.resolve({ rest }) })).rejects.toThrow('NEXT_REDIRECT')
  return redirect.mock.calls[0][0]
}

it('구 message-templates 는 지원자 목록으로 이동한다', async () => {
  expect(await run(['message-templates'])).toBe('/d/recruiting/applications')
})

it('applications 하위 경로는 그대로 이어 붙인다', async () => {
  expect(await run(['applications', 'abc'])).toBe('/d/recruiting/applications/abc')
})
