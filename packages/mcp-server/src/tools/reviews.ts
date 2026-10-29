import { addDays, complaintCategories, weekdayOf, type Database } from "@copiloto/data"
import { z } from "zod"
import { classifyComment } from "./complaints.ts"
import { average, findMenuItem, isoDate, periodFilter, ratio, resolvePeriod, roundTo } from "./shared.ts"

export const analyzeReviewsShape = {
  start_date: isoDate.optional().describe("First order day (inclusive), YYYY-MM-DD. Defaults to 27 days before end_date."),
  end_date: isoDate.optional().describe("Last order day (inclusive), YYYY-MM-DD. Defaults to the most recent day with orders."),
  menu_item_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Only reviews of orders that contained this menu item. Get ids from list_menu_items."),
}

const analyzeReviewsSchema = z.object(analyzeReviewsShape)

type ReviewRow = {
  rating: number
  comment: string | null
  order_date: string
}

export async function analyzeReviews(db: Database, input: z.input<typeof analyzeReviewsSchema> = {}) {
  const { menu_item_id, ...dates } = analyzeReviewsSchema.parse(input)
  const period = await resolvePeriod(db, dates)
  const menuItem = menu_item_id === undefined ? null : await findMenuItem(db, menu_item_id)

  const { rows } = await db.query<ReviewRow>(
    `select r.rating, r.comment, o.placed_at::date::text as order_date
     from reviews r
     join orders o on o.id = r.order_id
     where ${periodFilter}
       and ($3::int is null or exists (
         select 1 from order_items oi where oi.order_id = o.id and oi.menu_item_id = $3::int
       ))
     order by o.placed_at desc`,
    [period.start_date, period.end_date, menu_item_id ?? null],
  )

  const classified = rows.map((row) => ({ ...row, complaints: classifyComment(row.comment) }))

  return {
    period,
    menu_item: menuItem,
    review_count: rows.length,
    avg_rating: rows.length === 0 ? null : roundTo(average(rows.map((row) => row.rating)), 2),
    rating_distribution: Object.fromEntries(
      [1, 2, 3, 4, 5].map((rating) => [rating, rows.filter((row) => row.rating === rating).length]),
    ),
    complaints: complaintCategories
      .map((category) => {
        const matches = classified.filter((row) => row.complaints.includes(category))
        return {
          category,
          count: matches.length,
          share_of_reviews: roundTo(ratio(matches.length, rows.length), 3),
          recent_examples: matches.slice(0, 3).map(({ order_date, rating, comment }) => ({ order_date, rating, comment })),
        }
      })
      .filter((complaint) => complaint.count > 0)
      .sort((first, second) => second.count - first.count),
    weekly: weeklyRatings(rows),
  }
}

function weeklyRatings(rows: ReviewRow[]) {
  const weeks = new Map<string, number[]>()
  for (const row of rows) {
    const weekStart = addDays(row.order_date, -((weekdayOf(row.order_date) + 6) % 7))
    weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), row.rating])
  }
  return [...weeks]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([week_start, ratings]) => ({
      week_start,
      review_count: ratings.length,
      avg_rating: roundTo(average(ratings), 2),
    }))
}
