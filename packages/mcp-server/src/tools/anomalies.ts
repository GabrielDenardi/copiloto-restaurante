import { addDays, eachDay, weekdayNames, weekdayOf, type Database, type WeekdayName } from "@copiloto/data"
import { z } from "zod"
import { topComplaint } from "./complaints.ts"
import {
  isoDate,
  median,
  percentChange,
  previousPeriod,
  ratio,
  resolvePeriod,
  roundTo,
  type Period,
} from "./shared.ts"

export const detectAnomaliesShape = {
  start_date: isoDate.optional().describe("First day of the window to inspect, YYYY-MM-DD. Defaults to 27 days before end_date."),
  end_date: isoDate.optional().describe("Last day of the window to inspect, YYYY-MM-DD. Defaults to the most recent day with orders."),
}

const detectAnomaliesSchema = z.object(detectAnomaliesShape)

const minimumDaysForTrends = 14
const minimumReviewsPerWindow = 8
const minimumRatingDrop = 0.5
const minimumZScore = 3.5
const maximumDailyPValue = 0.0001

type AnomalyType =
  | "daily_orders"
  | "daily_cancellation_rate"
  | "daily_prep_time"
  | "weekday_orders_shift"
  | "menu_item_rating_drop"

type Anomaly = {
  type: AnomalyType
  severity: "high" | "medium"
  date?: string
  weekday?: WeekdayName
  menu_item?: { id: number; name: string }
  value: number
  typical: number
  change_percent: number | null
  z_score?: number
  top_complaint?: ReturnType<typeof topComplaint>
  description: string
}

type DailyRow = {
  day: string
  orders: number
  cancelled: number
  avg_prep_minutes: number
}

type RatingWindowRow = {
  id: number
  name: string
  recent_avg: number | null
  recent_var: number | null
  recent_count: number
  before_avg: number | null
  before_var: number | null
  before_count: number
}

type RatingDrop = {
  id: number
  name: string
  recentAverage: number
  beforeAverage: number
  recentCount: number
  zScore: number
  excludedItems: { id: number; name: string }[]
}

export async function detectAnomalies(db: Database, input: z.input<typeof detectAnomaliesSchema> = {}) {
  const period = await resolvePeriod(db, detectAnomaliesSchema.parse(input))
  const baseline = previousPeriod(period)
  const daily = await fetchDaily(db, addDays(period.start_date, -Math.max(28, period.days)), period.end_date)
  const checksTrends = period.days >= minimumDaysForTrends

  const anomalies = [
    ...findDailySpikes(daily, period),
    ...(checksTrends ? findWeekdayShifts(daily, period, baseline) : []),
    ...(checksTrends ? await findRatingDrops(db, period, baseline) : []),
  ].sort(bySeverityThenDate)

  return {
    period,
    baseline_period: baseline,
    anomalies,
    notes: checksTrends
      ? []
      : [`Windows shorter than ${minimumDaysForTrends} days only check daily spikes against the same weekday.`],
  }
}

async function fetchDaily(db: Database, start: string, end: string): Promise<Map<string, DailyRow>> {
  const { rows } = await db.query<DailyRow>(
    `select placed_at::date::text as day,
       count(*)::int as orders,
       count(*) filter (where status = 'cancelled')::int as cancelled,
       avg(prep_minutes)::float8 as avg_prep_minutes
     from orders
     where placed_at >= $1::date and placed_at < $2::date + 1
     group by 1`,
    [start, end],
  )
  return new Map(rows.map((row) => [row.day, row]))
}

function findDailySpikes(daily: Map<string, DailyRow>, period: Period): Anomaly[] {
  return eachDay(period.start_date, period.end_date).flatMap((day) => {
    const row = daily.get(day)
    const sameWeekdays = [7, 14, 21, 28]
      .map((offset) => daily.get(addDays(day, -offset)))
      .filter((previous) => previous !== undefined)
    if (!row || sameWeekdays.length < 2) return []

    const weekday = weekdayNames[weekdayOf(day)]!
    const anomalies: Anomaly[] = []

    const typicalOrders = median(sameWeekdays.map((previous) => previous.orders))
    const ordersChange = ratio(row.orders - typicalOrders, typicalOrders)
    if (ordersChange <= -0.35 || ordersChange >= 0.5) {
      anomalies.push({
        type: "daily_orders",
        severity: Math.abs(ordersChange) >= 0.5 ? "high" : "medium",
        date: day,
        weekday,
        value: row.orders,
        typical: typicalOrders,
        change_percent: percentChange(row.orders, typicalOrders),
        description: `${row.orders} orders on ${day} (${weekday}) vs a typical ${typicalOrders} for the previous ${weekday}s.`,
      })
    }

    const previousMonth = Array.from({ length: 28 }, (_, index) => daily.get(addDays(day, -(index + 1)))).filter(
      (previous) => previous !== undefined,
    )
    const cancellationRate = ratio(row.cancelled, row.orders)
    const typicalRate = ratio(
      sum(previousMonth.map((previous) => previous.cancelled)),
      sum(previousMonth.map((previous) => previous.orders)),
    )
    const expectedCancellations = row.orders * Math.max(typicalRate, 0.01)
    const cancellationPValue = poissonUpperTail(row.cancelled, expectedCancellations)
    if (cancellationRate >= 0.1 && cancellationPValue < maximumDailyPValue) {
      anomalies.push({
        type: "daily_cancellation_rate",
        severity: cancellationRate >= 0.2 ? "high" : "medium",
        date: day,
        weekday,
        value: roundTo(cancellationRate, 3),
        typical: roundTo(typicalRate, 3),
        change_percent: percentChange(cancellationRate, typicalRate),
        description: `${row.cancelled} of ${row.orders} orders were cancelled on ${day} (${formatPercent(cancellationRate)}) vs a typical ${formatPercent(typicalRate)} over the previous 28 days.`,
      })
    }

    const typicalPrep = median(sameWeekdays.map((previous) => previous.avg_prep_minutes))
    const extraPrep = row.avg_prep_minutes - typicalPrep
    if (extraPrep >= 10) {
      anomalies.push({
        type: "daily_prep_time",
        severity: extraPrep >= 15 ? "high" : "medium",
        date: day,
        weekday,
        value: roundTo(row.avg_prep_minutes, 1),
        typical: roundTo(typicalPrep, 1),
        change_percent: percentChange(row.avg_prep_minutes, typicalPrep),
        description: `Average prep time on ${day} was ${roundTo(row.avg_prep_minutes, 1)} min vs a typical ${roundTo(typicalPrep, 1)} min on ${weekday}s.`,
      })
    }

    return anomalies
  })
}

function findWeekdayShifts(daily: Map<string, DailyRow>, period: Period, baseline: Period): Anomaly[] {
  const recent = ordersByWeekday(daily, period)
  const before = ordersByWeekday(daily, baseline)
  const overallChange = ratio(sum(recent.totals) - sum(before.totals), sum(before.totals))

  return weekdayNames.flatMap((weekday, index) => {
    const recentAverage = ratio(recent.totals[index]!, recent.days[index]!)
    const beforeAverage = ratio(before.totals[index]!, before.days[index]!)
    if (beforeAverage === 0) return []

    const change = ratio(recentAverage - beforeAverage, beforeAverage)
    const gap = change - overallChange
    if (Math.abs(change) < 0.2 || Math.abs(gap) < 0.15) return []

    return [
      {
        type: "weekday_orders_shift" as const,
        severity: Math.abs(gap) >= 0.3 ? ("high" as const) : ("medium" as const),
        weekday,
        value: roundTo(recentAverage, 1),
        typical: roundTo(beforeAverage, 1),
        change_percent: roundTo(change * 100, 1),
        description: `Average ${weekday} orders went from ${roundTo(beforeAverage, 1)} to ${roundTo(recentAverage, 1)} per day (${formatSignedPercent(change)}) between ${baseline.start_date}..${baseline.end_date} and ${period.start_date}..${period.end_date}, while overall orders changed ${formatSignedPercent(overallChange)}.`,
      },
    ]
  })
}

async function findRatingDrops(db: Database, period: Period, baseline: Period): Promise<Anomaly[]> {
  const drops: RatingDrop[] = []
  let next = await strongestRatingDrop(db, period, baseline, [])

  while (next) {
    drops.push(next)
    next = await strongestRatingDrop(db, period, baseline, drops)
  }

  return Promise.all(drops.map((drop) => describeRatingDrop(db, period, drop)))
}

async function strongestRatingDrop(
  db: Database,
  period: Period,
  baseline: Period,
  explained: RatingDrop[],
): Promise<RatingDrop | null> {
  const excludedItems = explained.map(({ id, name }) => ({ id, name }))
  const excludedIds = excludedItems.map((item) => item.id)

  const { rows } = await db.query<RatingWindowRow>(
    `select m.id, m.name,
       avg(r.rating) filter (where o.placed_at >= $3::date)::float8 as recent_avg,
       var_samp(r.rating) filter (where o.placed_at >= $3::date)::float8 as recent_var,
       count(*) filter (where o.placed_at >= $3::date)::int as recent_count,
       avg(r.rating) filter (where o.placed_at < $3::date)::float8 as before_avg,
       var_samp(r.rating) filter (where o.placed_at < $3::date)::float8 as before_var,
       count(*) filter (where o.placed_at < $3::date)::int as before_count
     from reviews r
     join orders o on o.id = r.order_id
     join order_items oi on oi.order_id = o.id
     join menu_items m on m.id = oi.menu_item_id
     where o.placed_at >= $1::date and o.placed_at < $2::date + 1
       and not exists (
         select 1 from order_items explained
         where explained.order_id = o.id and explained.menu_item_id = any($4::int[])
       )
     group by m.id, m.name`,
    [baseline.start_date, period.end_date, period.start_date, excludedIds],
  )

  const [strongest] = rows
    .map((row) => ({ row, zScore: ratingDropZScore(row) }))
    .filter(({ row, zScore }) => zScore >= minimumZScore && row.before_avg! - row.recent_avg! >= minimumRatingDrop)
    .sort((first, second) => second.zScore - first.zScore)

  if (!strongest) return null

  return {
    id: strongest.row.id,
    name: strongest.row.name,
    recentAverage: strongest.row.recent_avg!,
    beforeAverage: strongest.row.before_avg!,
    recentCount: strongest.row.recent_count,
    zScore: strongest.zScore,
    excludedItems,
  }
}

function ratingDropZScore(row: RatingWindowRow): number {
  if (row.recent_count < minimumReviewsPerWindow || row.before_count < minimumReviewsPerWindow) return 0
  if (row.recent_avg === null || row.before_avg === null) return 0

  const standardError = Math.sqrt(
    (row.recent_var ?? 0) / row.recent_count + (row.before_var ?? 0) / row.before_count,
  )
  return standardError === 0 ? 0 : (row.before_avg - row.recent_avg) / standardError
}

async function describeRatingDrop(db: Database, period: Period, drop: RatingDrop): Promise<Anomaly> {
  const complaint = topComplaint(await recentComments(db, period, drop.id, drop.excludedItems))
  const complaintText = complaint
    ? ` The most common complaint is ${complaint.category} (${formatPercent(complaint.share_of_reviews)} of its reviews).`
    : ""
  const exclusionText =
    drop.excludedItems.length > 0
      ? ` Orders that also had ${drop.excludedItems.map((item) => item.name).join(", ")} were left out so their complaints are not counted twice.`
      : ""

  return {
    type: "menu_item_rating_drop",
    severity: drop.beforeAverage - drop.recentAverage >= 1 ? "high" : "medium",
    menu_item: { id: drop.id, name: drop.name },
    value: roundTo(drop.recentAverage, 2),
    typical: roundTo(drop.beforeAverage, 2),
    change_percent: percentChange(drop.recentAverage, drop.beforeAverage),
    z_score: roundTo(drop.zScore, 1),
    top_complaint: complaint,
    description: `Average rating of orders with ${drop.name} fell from ${roundTo(drop.beforeAverage, 2)} to ${roundTo(drop.recentAverage, 2)} (${drop.recentCount} recent reviews).${complaintText}${exclusionText}`,
  }
}

async function recentComments(
  db: Database,
  period: Period,
  menuItemId: number,
  excludedItems: { id: number }[],
): Promise<(string | null)[]> {
  const { rows } = await db.query<{ comment: string | null }>(
    `select r.comment
     from reviews r
     join orders o on o.id = r.order_id
     join order_items oi on oi.order_id = o.id
     where oi.menu_item_id = $3 and o.placed_at >= $1::date and o.placed_at < $2::date + 1
       and not exists (
         select 1 from order_items explained
         where explained.order_id = o.id and explained.menu_item_id = any($4::int[])
       )`,
    [period.start_date, period.end_date, menuItemId, excludedItems.map((item) => item.id)],
  )
  return rows.map((row) => row.comment)
}

function ordersByWeekday(daily: Map<string, DailyRow>, period: Period) {
  const totals = Array.from({ length: 7 }, () => 0)
  const days = Array.from({ length: 7 }, () => 0)
  for (const day of eachDay(period.start_date, period.end_date)) {
    const weekday = weekdayOf(day)
    totals[weekday]! += daily.get(day)?.orders ?? 0
    days[weekday]! += 1
  }
  return { totals, days }
}

function bySeverityThenDate(first: Anomaly, second: Anomaly): number {
  if (first.severity !== second.severity) return first.severity === "high" ? -1 : 1
  return (first.date ?? "").localeCompare(second.date ?? "")
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function poissonUpperTail(observed: number, expected: number): number {
  if (observed <= 0) return 1
  let term = Math.exp(-expected)
  let cumulative = term
  for (let count = 1; count < observed; count++) {
    term *= expected / count
    cumulative += term
  }
  return Math.max(0, 1 - cumulative)
}

function formatPercent(value: number): string {
  return `${roundTo(value * 100, 1)}%`
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`
}
