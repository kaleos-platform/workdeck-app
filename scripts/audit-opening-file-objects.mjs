// 원본의 고객별 첨부 참조만 HEAD로 확인한다. 내용·파일명·key·URL은 결과에 포함하지 않는다.
export async function inspectFileObjects(client, ids, expectedBucket, headObject) {
  let rows
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '30s'")
    const scope = await client.query(
      'SELECT count(*)::text AS total FROM brand WHERE id = ANY($1::bigint[])',
      [ids]
    )
    if (Number(scope.rows[0].total) !== ids.length) throw Error('scope')
    const result = await client.query(
      `SELECT f.file_key, f.storage, f.storage_type, f.status
      FROM file f JOIN application a ON a.id = f.target_id
      WHERE f.target_type = 'appl_userfile' AND a.brand_id = ANY($1::bigint[])`,
      [ids]
    )
    rows = result.rows
  } finally {
    await client.query('ROLLBACK')
  }
  const report = {
    references: rows.length,
    uniqueObjects: 0,
    metadataBlocked: 0,
    found: 0,
    missing: 0,
    inaccessible: 0,
    empty: 0,
    over10MiB: 0,
    totalBytes: 0,
    mimeTypes: {},
    contentChecksumVerified: false,
  }
  const seen = new Set()
  const objects = []
  for (const row of rows) {
    if (
      !expectedBucket ||
      row.storage !== expectedBucket ||
      row.storage_type !== 's3' ||
      row.status !== 1 ||
      typeof row.file_key !== 'string' ||
      !row.file_key
    ) {
      report.metadataBlocked++
      continue
    }
    if (seen.has(row.file_key)) continue
    seen.add(row.file_key)
    objects.push(row)
  }
  report.uniqueObjects = objects.length
  const knownMime = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-hwp',
    'application/haansofthwp',
    'application/octet-stream',
  ])
  // AWS CLI 과부하를 피하고 실패한 객체도 누락 없이 집계한다.
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(4, objects.length) }, async () => {
      while (cursor < objects.length) {
        const row = objects[cursor++]
        let head
        try {
          head = await headObject(row.storage, row.file_key)
        } catch {
          report.inaccessible++
          continue
        }
        if (head.status === 'missing') {
          report.missing++
          continue
        }
        if (head.status !== 'found' || !Number.isSafeInteger(head.bytes) || head.bytes < 0) {
          report.inaccessible++
          continue
        }
        report.found++
        report.totalBytes += head.bytes
        if (!head.bytes) report.empty++
        if (head.bytes > 10 * 1024 * 1024) report.over10MiB++
        const mime = knownMime.has(head.mime) ? head.mime : 'other_or_missing'
        report.mimeTypes[mime] = (report.mimeTypes[mime] ?? 0) + 1
      }
    })
  )
  return report
}
