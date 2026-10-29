import { addDays, daysBetween, isValidDate, type Database } from "@copiloto/data"
import { z } from "zod"

export const isoDate = z.string().refine(isValidDate, "Use a valid date in YYYY-MM-DD format")

export const periodFilter = "placed_at >= $1::date and placed_at < $2::date + 1"

export type Period = {
  start_date: string
  end_date: string
  days: number
}

export type PeriodInput = {
  start_date?: string | undefined
  end_date?: string | undefined
}

export async function resolvePeriod(db: Database, input: PeriodInput, defaultDays = 28): Promise<Period> {
  const end = input.end_date ?? (await lastOrderDate(db))
  const start = input.start_date ?? addDays(end, -(defaultDays - 1))
  if (start > end) throw new Error(`start_date (${start}) must be on or before end_date (${end})`)
  return { start_date: start, end_date: end, days: daysBetween(start, end) + 1 }
}

export function previousPeriod(period: Period): Period {
  const end = addDays(period.start_date, -1)
  return { start_date: addDays(end, -(period.days - 1)), end_date: end, days: period.days }
}

export async function findMenuItem(db: Database, id: number): Promise<{ id: number; name: string }> {
  const { rows } = await db.query<{ id: number; name: string }>("select id, name from menu_items where id = $1", [id])
  const item = rows[0]
  if (!item) throw new Error(`Unknown menu_item_id ${id}. Call list_menu_items to see the valid ids.`)
  return item
}

export const toReais = (cents: number) => Math.round(cents) / 100

export const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

export const percentChange = (current: number, previous: number) =>
  previous === 0 ? null : roundTo(((current - previous) / previous) * 100, 1)

export function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

async function lastOrderDate(db: Database): Promise<string> {
  const { rows } = await db.query<{ last_day: string | null }>(
    "select max(placed_at)::date::text as last_day from orders",
  )
  const lastDay = rows[0]?.last_day
  if (!lastDay) throw new Error("There are no orders in the database")
  return lastDay
}
