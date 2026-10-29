import { rm } from "node:fs/promises"
import { defaultDataDir, openDatabase } from "./database.ts"

const dataDir = process.env.COPILOTO_DATA_DIR ?? defaultDataDir

await rm(dataDir, { recursive: true, force: true })
const db = await openDatabase({ dataDir })

const { rows } = await db.query<{ table: string; rows: number }>(`
  select 'menu_items' as table, count(*)::int as rows from menu_items
  union all select 'orders', count(*)::int from orders
  union all select 'order_items', count(*)::int from order_items
  union all select 'reviews', count(*)::int from reviews
`)

console.log(`Banco gerado em ${dataDir}`)
console.table(rows)
await db.close()
