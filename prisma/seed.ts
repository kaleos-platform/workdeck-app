import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SYSTEM_TEMPLATES } from '../src/lib/sc/template-engine'

config({ path: '.env.local', override: true })

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL 또는 DIRECT_URL 환경변수가 필요합니다')

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter } as never)

async function main() {
  console.log('🌱 DeckApp 시드 데이터 적용 중...')

  const deckApps = [
    { id: 'coupang-ads', name: '쿠팡 광고 자동화', isActive: true },
    { id: 'seller-hub', name: '브랜드 운영', isActive: true },
    { id: 'sales-content', name: '세일즈 콘텐츠', isActive: true },
    { id: 'finance', name: '재무 관리', isActive: true },
    { id: 'blog-ops', name: '블로그 운영', isActive: true },
    { id: 'delivery-mgmt', name: '통합 배송 관리', isActive: false },
    { id: 'inventory-mgmt', name: '통합 재고 관리', isActive: false },
    { id: 'osmu', name: 'OSMU 광고 제작', isActive: false },
    { id: 'commerce-ops', name: '이커머스 운영 자동화', isActive: false },
    { id: 'hiring-posts', name: '공고 제작', isActive: false },
    { id: 'hiring-applicants', name: '지원자 관리', isActive: false },
    { id: 'recruiting', name: '모집 관리', isActive: true },
  ]

  for (const app of deckApps) {
    await prisma.deckApp.upsert({
      where: { id: app.id },
      create: app,
      update: { name: app.name, isActive: app.isActive },
    })
    console.log(`  ✔ DeckApp [${app.id}] upsert 완료`)
  }

  console.log('🌱 Sales Content 시스템 템플릿 seed...')
  for (const t of SYSTEM_TEMPLATES) {
    // spaceId=null + name 기준으로 기존 행 탐색 후 update/create.
    const existing = await prisma.template.findFirst({
      where: { spaceId: null, isSystem: true, name: t.name },
      select: { id: true },
    })
    if (existing) {
      await prisma.template.update({
        where: { id: existing.id },
        data: {
          name: t.name,
          kind: t.kind,
          sections: t.sections,
          isSystem: true,
          isActive: true,
        },
      })
    } else {
      await prisma.template.create({
        data: {
          spaceId: null,
          name: t.name,
          kind: t.kind,
          sections: t.sections,
          isSystem: true,
          isActive: true,
        },
      })
    }
    console.log(`  ✔ Template [${t.name}] upsert 완료`)
  }

  console.log('✅ 시드 완료')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
