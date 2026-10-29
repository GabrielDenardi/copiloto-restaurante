import type { Database } from "@copiloto/data"
import { toReais } from "./shared.ts"

type MenuItemRow = {
  id: number
  name: string
  category: string
  price_cents: number
}

export async function listMenuItems(db: Database) {
  const { rows } = await db.query<MenuItemRow>("select id, name, category, price_cents from menu_items order by id")
  return {
    menu_items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      price_brl: toReais(row.price_cents),
    })),
  }
}
