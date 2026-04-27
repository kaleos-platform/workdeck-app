// Sales Content — DB row count snapshot (ops 도구).
// 신규 환경 bring-up·smoke 직전 / 마이그레이션 직후 데이터 분포 빠른 확인용.
//
// 사용:
//   npx tsx scripts/sc/ops/db-stats.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { prisma } = await import('../../../src/lib/prisma')

  const [
    spaces,
    channels,
    credentials,
    contents,
    deployments,
    deploymentsPublished,
    deploymentsFailed,
    jobs,
    jobsPending,
    jobsFailed,
  ] = await Promise.all([
    prisma.space.count(),
    prisma.salesContentChannel.count(),
    prisma.channelCredential.count(),
    prisma.content.count(),
    prisma.contentDeployment.count(),
    prisma.contentDeployment.count({ where: { status: 'PUBLISHED' } }),
    prisma.contentDeployment.count({ where: { status: 'FAILED' } }),
    prisma.salesContentJob.count(),
    prisma.salesContentJob.count({ where: { status: 'PENDING' } }),
    prisma.salesContentJob.count({ where: { status: 'FAILED' } }),
  ])

  console.log('Space                ', spaces)
  console.log('SalesContentChannel  ', channels)
  console.log('ChannelCredential    ', credentials)
  console.log('Content              ', contents)
  console.log(
    'ContentDeployment    ',
    deployments,
    `(PUBLISHED=${deploymentsPublished}, FAILED=${deploymentsFailed})`
  )
  console.log('SalesContentJob      ', jobs, `(PENDING=${jobsPending}, FAILED=${jobsFailed})`)

  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
