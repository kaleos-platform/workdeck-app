import { isSlugConflict } from '../deployments'

it('shortSlug unique 위반만 slug 충돌로 본다', () => {
  expect(isSlugConflict({ code: 'P2002', meta: { target: ['shortSlug'] } })).toBe(true)
  expect(
    isSlugConflict({ code: 'P2002', meta: { target: 'ContentDeployment_shortSlug_key' } })
  ).toBe(true)
  expect(isSlugConflict({ code: 'P2002', meta: { target: ['idempotencyKey'] } })).toBe(false)
  expect(isSlugConflict({ code: 'P2003', meta: { target: ['shortSlug'] } })).toBe(false)
})
