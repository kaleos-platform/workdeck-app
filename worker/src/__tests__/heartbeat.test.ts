/** @jest-environment node */

import { HEARTBEAT_INTERVAL_MS } from '../heartbeat'

describe('worker heartbeat', () => {
  it('DB write 빈도를 낮추기 위해 2분 간격으로 전송한다', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(120_000)
  })
})
