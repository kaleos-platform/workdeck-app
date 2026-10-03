import { fileFieldError, fileFieldLabel } from '../file-fields'
const fields = [
  { key: 'resume', type: 'file', required: true },
  { key: 'portfolio', type: 'file' },
  { key: 'name', type: 'string' },
]
it('필수 첨부와 파일별 항목 연결을 검증한다', () => {
  expect(fileFieldError(fields, [], 0)).not.toBeNull()
  expect(fileFieldError(fields, ['resume'], 0)).not.toBeNull()
  expect(fileFieldError(fields, ['resume', 'resume'], 2)).not.toBeNull()
  expect(fileFieldError(fields, ['resume', 'name'], 2)).not.toBeNull()
  expect(fileFieldError(fields, ['unknown'], 1)).not.toBeNull()
  expect(fileFieldError(fields, ['resume', 'portfolio'], 2)).toBeNull()
})

it('파일명 추측 없이 유일한 파일 ID 연결에서만 항목명을 얻는다', () => {
  const entries = [
    { key: 'a', type: 'file', label: '이력서', fileIds: ['one'] },
    { key: 'b', type: 'file', label: '포트폴리오', fileIds: ['two'] },
  ]
  expect(fileFieldLabel(entries, 'one')).toBe('이력서')
  expect(fileFieldLabel(entries, 'two')).toBe('포트폴리오')
  expect(fileFieldLabel(entries, 'legacy')).toBeUndefined()
  expect(fileFieldLabel([...entries, { ...entries[1], fileIds: ['one'] }], 'one')).toBeUndefined()
  expect(fileFieldLabel([null, { type: 'file', fileIds: 'one' }], 'one')).toBeUndefined()
})

it('항목별 복수 첨부와 byte 경계를 검증한다', () => {
  const fields = [{ key: 'resume', type: 'file', required: true, maxFileCount: 2, maxFileSize: 3 }]
  expect(fileFieldError(fields, ['resume', 'resume'], 2, [3, 2])).toBeNull()
  expect(fileFieldError(fields, ['resume', 'resume', 'resume'], 3, [1, 1, 1])).not.toBeNull()
  expect(fileFieldError(fields, ['resume'], 1, [4])).not.toBeNull()
  expect(fileFieldError(fields, ['resume'], 1, [0])).not.toBeNull()
})
