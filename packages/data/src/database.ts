import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite"
import { fileURLToPath } from "node:url"
import { generateDataset, type Dataset } from "./generate.ts"
import { schemaSql } from "./schema.ts"

export type Database = PGliteInterface

export type OpenDatabaseOptions = {
  dataDir?: string
  dataset?: Dataset
}

export const defaultDataDir = fileURLToPath(new URL("../../../.pgdata", import.meta.url))

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<Database> {
  const db = await PGlite.create(options.dataDir)
  await db.exec(schemaSql)

  const { rows } = await db.query<{ total: number }>("select count(*)::int as total from menu_items")
  if (rows[0]?.total === 0) await seedDatabase(db, options.dataset ?? generateDataset())

  return db
}

export async function resetDatabase(db: Database, dataset: Dataset): Promise<void> {
  await db.exec("truncate reviews, order_items, orders, menu_items, campaign_drafts restart identity")
  await seedDatabase(db, dataset)
}

export async function seedDatabase(db: Database, dataset: Dataset): Promise<void> {
  await db.transaction(async (tx) => {
    await insertRows(
      tx,
      "menu_items",
      dataset.menuItems.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        price_cents: item.priceCents,
        prep_minutes: item.prepMinutes,
      })),
    )
    await insertRows(
      tx,
      "orders",
      dataset.orders.map((order) => ({
        id: order.id,
        placed_at: order.placedAt,
        status: order.status,
        cancel_reason: order.cancelReason,
        prep_minutes: order.prepMinutes,
        delivery_minutes: order.deliveryMinutes,
        total_cents: order.totalCents,
      })),
    )
    await insertRows(
      tx,
      "order_items",
      dataset.orderItems.map((item) => ({
        order_id: item.orderId,
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
      })),
    )
    await insertRows(
      tx,
      "reviews",
      dataset.reviews.map((review) => ({
        id: review.id,
        order_id: review.orderId,
        created_at: review.createdAt,
        rating: review.rating,
        comment: review.comment,
      })),
    )
  })
}

async function insertRows(tx: Transaction, table: string, rows: object[]): Promise<void> {
  await tx.query(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json)`, [
    JSON.stringify(rows),
  ])
}
