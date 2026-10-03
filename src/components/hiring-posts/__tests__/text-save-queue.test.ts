import { createTextSaveQueue } from '../text-save-queue'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it('지연된 첫 요청 이후 최신 본문을 직렬 저장하고 flush가 두 요청을 기다린다', async () => {
  let finish!: () => void
  const save = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue(undefined)
  const queue = createTextSaveQueue(save, jest.fn())
  queue.schedule('text', '처음')
  jest.advanceTimersByTime(700)
  queue.schedule('text', '최신')
  jest.advanceTimersByTime(700)
  const flushed = jest.fn()
  const pending = queue.flush().then(flushed)
  expect(save).toHaveBeenCalledTimes(1)
  expect(flushed).not.toHaveBeenCalled()
  finish()
  await pending
  expect(save.mock.calls).toEqual([
    ['text', '처음'],
    ['text', '최신'],
  ])
  expect(flushed).toHaveBeenCalledTimes(1)
})

it('실패한 본문을 보관하고 다음 flush에서 재시도한다', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const queue = createTextSaveQueue(save, jest.fn())
  queue.schedule('text', '최신')
  await expect(queue.flush()).rejects.toThrow('offline')
  await queue.flush()
  expect(save.mock.calls).toEqual([
    ['text', '최신'],
    ['text', '최신'],
  ])
})

it('실패한 요청보다 최신 편집을 재시도하며 삭제한 블록의 타이머는 실행하지 않는다', async () => {
  let fail!: (error: Error) => void
  const save = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject
        })
    )
    .mockResolvedValue(undefined)
  const queue = createTextSaveQueue(save, jest.fn())
  queue.schedule('text', '처음')
  const request = queue.flush()
  queue.schedule('text', '최신')
  fail(new Error('offline'))
  await expect(request).rejects.toThrow('offline')
  await queue.flush()
  queue.schedule('deleted', '삭제 본문')
  queue.cancel('deleted')
  jest.runAllTimers()
  expect(save.mock.calls).toEqual([
    ['text', '처음'],
    ['text', '최신'],
  ])
})
