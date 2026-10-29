import { eachDay, weekdayNames, weekdayOf, type Database } from "@copiloto/data"
import { z } from "zod"
import {
  isoDate,
  percentChange,
  periodFilter,
  previousPeriod,
  ratio,
  resolvePeriod,
  roundTo,
  toReais,
  type Period,
} from "./shared.ts"

export const salesSummaryShape = {
  start_date: isoDate.optional().describe("First day (inclusive), YYYY-MM-DD. Defaults to 27 days before end_date."),
  end_date: isoDate.optional().describe("Last day (inclusive), YYYY-MM-DD. Defaults to the most recent day with orders."),
  group_by: z
    .enum(["none", "day", "weekday", "hour", "menu_item"])
    .default("none")
    .describe("Optional breakdown of the totals."),
  compare_with_previous_period: z
    .boolean()
    .default(false)
    .describe("Also return the totals of the same number of days right before start_date, with percent changes."),
}

const salesSummarySchema = z.object(salesSummaryShape)

type CountsRow = {
  orders: number
  delivered_orders: number
  cancelled_orders: number
  revenue_cents: number
}

type KeyedCountsRow = CountsRow & { key: number | string }

type MenuItemSalesRow = {
  id: number
  name: string
  category: string
  orders: number
  quantity_sold: number
  revenue_cents: number
}

const countsSelect = `
  count(*)::int as orders,
  count(*) filter (where status = 'delivered')::int as delivered_orders,
  count(*) filter (where status = 'cancelled')::int as cancelled_orders,
  coalesce(sum(total_cents) filter (where status = 'delivered'), 0)::int as revenue_cents`

export async function getSalesSummary(db: Database, input: z.input<typeof salesSummarySchema> = {}) {
  const { group_by, compare_with_previous_period, ...dates } = salesSummarySchema.parse(input)
  const period = await resolvePeriod(db, dates)
  const totals = await fetchTotals(db, period)
  const breakdown = group_by === "none" ? undefined : await fetchBreakdown(db, period, group_by)

  if (!compare_with_previous_period) return { period, totals, breakdown }

  const previous = previousPeriod(period)
  const previousTotals = await fetchTotals(db, previous)

  return {
    period,
    totals,
    breakdown,
    previous_period: {
      period: previous,
      totals: previousTotals,
      change_percent: {
        orders: percentChange(totals.orders, previousTotals.orders),
        revenue_brl: percentChange(totals.revenue_brl, previousTotals.revenue_brl),
        avg_ticket_brl: percentChange(totals.avg_ticket_brl, previousTotals.avg_ticket_brl),
        cancellation_rate: percentChange(totals.cancellation_rate, previousTotals.cancellation_rate),
      },
    },
  }
}

async function fetchTotals(db: Database, period: Period) {
  const { rows } = await db.query<CountsRow>(`select ${countsSelect} from orders where ${periodFilter}`, [
    period.start_date,
    period.end_date,
  ])
  return summarize(rows[0]!)
}

async function fetchBreakdown(db: Database, period: Period, groupBy: "day" | "weekday" | "hour" | "menu_item") {
  const params = [period.start_date, period.end_date]

  if (groupBy === "menu_item") {
    const { rows } = await db.query<MenuItemSalesRow>(
      `select m.id, m.name, m.category,
         count(distinct o.id)::int as orders,
         sum(oi.quantity)::int as quantity_sold,
         sum(oi.quantity * oi.unit_price_cents)::int as revenue_cents
       from order_items oi
       join orders o on o.id = oi.order_id
       join menu_items m on m.id = oi.menu_item_id
       where o.status = 'delivered' and ${periodFilter}
       group by m.id, m.name, m.category
       order by revenue_cents desc`,
      params,
    )
    return rows.map(({ revenue_cents, ...row }) => ({ ...row, revenue_brl: toReais(revenue_cents) }))
  }

  const keyExpression = {
    day: "placed_at::date::text",
    weekday: "extract(dow from placed_at)::int",
    hour: "extract(hour from placed_at)::int",
  }[groupBy]

  const { rows } = await db.query<KeyedCountsRow>(
    `select ${keyExpression} as key, ${countsSelect} from orders where ${periodFilter} group by 1 order by 1`,
    params,
  )

  if (groupBy === "day") {
    return rows.map(({ key, ...counts }) => ({
      date: String(key),
      weekday: weekdayNames[weekdayOf(String(key))],
      ...summarize(counts),
    }))
  }

  if (groupBy === "hour") {
    return rows.map(({ key, ...counts }) => ({ hour: Number(key), ...summarize(counts) }))
  }

  const daysPerWeekday = countWeekdays(period)
  return rows.map(({ key, ...counts }) => {
    const daysInPeriod = daysPerWeekday[Number(key)]!
    return {
      weekday: weekdayNames[Number(key)],
      days_in_period: daysInPeriod,
      avg_orders_per_day: roundTo(ratio(counts.orders, daysInPeriod), 1),
      avg_revenue_per_day_brl: toReais(ratio(counts.revenue_cents, daysInPeriod)),
      ...summarize(counts),
    }
  })
}

function countWeekdays(period: Period): number[] {
  const counts = Array.from({ length: 7 }, () => 0)
  for (const day of eachDay(period.start_date, period.end_date)) counts[weekdayOf(day)]! += 1
  return counts
}

function summarize(row: CountsRow) {
  return {
    orders: row.orders,
    delivered_orders: row.delivered_orders,
    cancelled_orders: row.cancelled_orders,
    cancellation_rate: roundTo(ratio(row.cancelled_orders, row.orders), 3),
    revenue_brl: toReais(row.revenue_cents),
    avg_ticket_brl: toReais(ratio(row.revenue_cents, row.delivered_orders)),
  }
}
