import { weekdayNames, type Database } from "@copiloto/data"
import { z } from "zod"
import { resolvePeriod } from "./shared.ts"

export const draftCampaignShape = {
  name: z.string().trim().min(3).max(80).describe("Short campaign name shown to the owner."),
  goal: z
    .string()
    .trim()
    .min(3)
    .max(240)
    .describe("What the campaign should achieve, e.g. recover tuesday dinner orders."),
  discount_percent: z.number().int().min(5).max(30).describe("Discount offered, from 5 to 30 percent."),
  weekdays: z.array(z.enum(weekdayNames)).min(1).optional().describe("Days the campaign runs. Defaults to every day."),
  start_hour: z.number().int().min(0).max(23).optional().describe("First hour of the campaign (inclusive, 0-23). Requires end_hour."),
  end_hour: z.number().int().min(1).max(24).optional().describe("Hour the campaign stops (exclusive, 1-24). Requires start_hour."),
  menu_item_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe("Restrict the discount to these menu items. Defaults to the whole menu. Get ids from list_menu_items."),
}

const draftCampaignSchema = z.object(draftCampaignShape)

type DraftRow = {
  id: number
  created_at: string
  status: string
}

export async function draftCampaign(db: Database, input: z.input<typeof draftCampaignSchema>) {
  const draft = draftCampaignSchema.parse(input)

  if ((draft.start_hour === undefined) !== (draft.end_hour === undefined)) {
    throw new Error("Provide both start_hour and end_hour, or neither.")
  }
  if (draft.start_hour !== undefined && draft.end_hour !== undefined && draft.start_hour >= draft.end_hour) {
    throw new Error("start_hour must be lower than end_hour.")
  }

  const menuItems = await findMenuItems(db, draft.menu_item_ids ?? [])
  const weekdays = draft.weekdays ?? [...weekdayNames]
  const weekdayNumbers = weekdays.map((weekday) => weekdayNames.indexOf(weekday))
  const startHour = draft.start_hour ?? 0
  const endHour = draft.end_hour ?? 24
  const baselinePeriod = await resolvePeriod(db, {})

  const { rows: baselineRows } = await db.query<{ orders: number }>(
    `select count(*)::int as orders
     from orders o
     where o.status = 'delivered'
       and o.placed_at >= $1::date and o.placed_at < $2::date + 1
       and extract(dow from o.placed_at)::int = any($3::int[])
       and extract(hour from o.placed_at)::int >= $4 and extract(hour from o.placed_at)::int < $5
       and (cardinality($6::int[]) = 0 or exists (
         select 1 from order_items oi where oi.order_id = o.id and oi.menu_item_id = any($6::int[])
       ))`,
    [baselinePeriod.start_date, baselinePeriod.end_date, weekdayNumbers, startHour, endHour, menuItems.map((item) => item.id)],
  )

  const { rows } = await db.query<DraftRow>(
    `insert into campaign_drafts (name, goal, discount_percent, weekdays, start_hour, end_hour, menu_item_ids)
     values ($1, $2, $3, $4::int[], $5, $6, $7::int[])
     returning id, created_at::text, status`,
    [
      draft.name,
      draft.goal,
      draft.discount_percent,
      weekdayNumbers,
      draft.start_hour ?? null,
      draft.end_hour ?? null,
      menuItems.map((item) => item.id),
    ],
  )
  const saved = rows[0]!

  return {
    draft: {
      id: saved.id,
      status: saved.status,
      created_at: saved.created_at,
      name: draft.name,
      goal: draft.goal,
      discount_percent: draft.discount_percent,
      weekdays,
      hours: draft.start_hour === undefined ? "all day" : `${draft.start_hour}:00-${draft.end_hour}:00`,
      menu_items: menuItems.length === 0 ? "whole menu" : menuItems,
    },
    context: {
      baseline_period: baselinePeriod,
      delivered_orders_in_this_slot: baselineRows[0]!.orders,
    },
    next_step: "This is only a draft and nothing was published. Show it to the owner and ask for explicit approval.",
  }
}

async function findMenuItems(db: Database, ids: number[]): Promise<{ id: number; name: string }[]> {
  if (ids.length === 0) return []
  const uniqueIds = [...new Set(ids)]
  const { rows } = await db.query<{ id: number; name: string }>(
    "select id, name from menu_items where id = any($1::int[]) order by id",
    [uniqueIds],
  )
  const missing = uniqueIds.filter((id) => !rows.some((row) => row.id === id))
  if (missing.length > 0) {
    throw new Error(`Unknown menu_item_id ${missing.join(", ")}. Call list_menu_items to see the valid ids.`)
  }
  return rows
}
