import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '.env.local', override: true })
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Find all Inv* tables
  const tables: { table_name: string }[] = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'Inv%' AND table_name NOT LIKE 'Inventory%'
    ORDER BY table_name
  `)

  // Find Inv* enums
  const enums: { typname: string }[] = await prisma.$queryRawUnsafe(`
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname LIKE 'Inv%' AND t.typname NOT LIKE 'Inventory%'
    ORDER BY t.typname
  `)

  console.log('-- Tables:', tables.map(t => t.table_name).join(', '))
  console.log('-- Enums:', enums.map(e => e.typname).join(', '))

  // Generate CREATE TYPE statements for enums
  for (const e of enums) {
    const labels: { enumlabel: string }[] = await prisma.$queryRawUnsafe(`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = '${e.typname}')
      ORDER BY enumsortorder
    `)
    console.log(`CREATE TYPE "${e.typname}" AS ENUM (${labels.map(l => `'${l.enumlabel}'`).join(', ')});`)
  }
  console.log()

  // Generate CREATE TABLE statements
  for (const t of tables) {
    // Get columns with types
    const cols: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        column_name,
        data_type,
        udt_name,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${t.table_name}'
      ORDER BY ordinal_position
    `)

    const colDefs = cols.map(c => {
      let typ: string
      if (c.data_type === 'USER-DEFINED') typ = `"${c.udt_name}"`
      else if (c.data_type === 'character varying') typ = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'TEXT'
      else if (c.data_type === 'text') typ = 'TEXT'
      else if (c.data_type === 'integer') typ = 'INTEGER'
      else if (c.data_type === 'boolean') typ = 'BOOLEAN'
      else if (c.data_type === 'timestamp with time zone') typ = 'TIMESTAMPTZ'
      else if (c.data_type === 'timestamp without time zone') typ = 'TIMESTAMP(3)'
      else if (c.data_type === 'jsonb') typ = 'JSONB'
      else if (c.data_type === 'json') typ = 'JSONB'
      else typ = c.data_type.toUpperCase()

      const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL'
      const def = c.column_default ? ` DEFAULT ${c.column_default}` : ''
      return `    "${c.column_name}" ${typ}${def}${nullable}`
    }).join(',\n')

    console.log(`-- CreateTable\nCREATE TABLE "${t.table_name}" (\n${colDefs},\n    CONSTRAINT "${t.table_name}_pkey" PRIMARY KEY ("id")\n);\n`)
  }

  // Get indexes
  const indexes: { tablename: string; indexname: string; indexdef: string }[] = await prisma.$queryRawUnsafe(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename LIKE 'Inv%' AND tablename NOT LIKE 'Inventory%' AND indexname NOT LIKE '%_pkey'
    ORDER BY tablename, indexname
  `)
  console.log('-- Indexes:')
  for (const i of indexes) {
    console.log(i.indexdef + ';')
  }
  console.log()

  // Get foreign keys
  const fks: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      tc.table_name AS local_table,
      tc.constraint_name,
      kcu.column_name AS local_column,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column,
      rc.delete_rule, rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name LIKE 'Inv%' AND tc.table_name NOT LIKE 'Inventory%'
    ORDER BY tc.table_name, tc.constraint_name
  `)
  console.log('-- Foreign Keys:')
  for (const fk of fks) {
    console.log(`ALTER TABLE "${fk.local_table}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.local_column}") REFERENCES "${fk.foreign_table}"("${fk.foreign_column}") ON DELETE ${fk.delete_rule} ON UPDATE ${fk.update_rule};`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
