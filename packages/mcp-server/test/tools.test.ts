import { generateDataset, lasagnaMenuItemId, openDatabase, type Database } from "@copiloto/data"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { analyzeReviews, classifyComment, getSalesSummary, listMenuItems } from "../src/index.ts"

const dataset = generateDataset()
const { tuesdayDrop } = dataset.plantedPatterns
let db: Database

beforeAll(async () => {
  db = await openDatabase({ dataset })
})

afterAll(async () => {
  await db.close()
})

describe("list_menu_items", () => {
  it("returns the whole menu with prices in reais", async () => {
    const { menu_items } = await listMenuItems(db)

    expect(menu_items).toHaveLength(dataset.menuItems.length)
    expect(menu_items[0]).toEqual({ id: 1, name: "Lasanha à bolonhesa", category: "main", price_brl: 49.9 })
  })
})

describe("get_sales_summary", () => {
  it("matches the generated orders for the whole period", async () => {
    const summary = await getSalesSummary(db, { start_date: dataset.period.start, end_date: dataset.period.end })
    const delivered = dataset.orders.filter((order) => order.status === "delivered")
    const revenueCents = delivered.reduce((sum, order) => sum + order.totalCents, 0)

    expect(summary.totals.orders).toBe(dataset.orders.length)
    expect(summary.totals.delivered_orders).toBe(delivered.length)
    expect(summary.totals.revenue_brl).toBe(revenueCents / 100)
  })

  it("defaults to the last 28 days with orders", async () => {
    const summary = await getSalesSummary(db)

    expect(summary.period).toEqual({ start_date: "2026-09-28", end_date: "2026-10-25", days: 28 })
  })

  it("shows tuesday as the weakest weekday in the last four weeks", async () => {
    const summary = await getSalesSummary(db, { start_date: tuesdayDrop.from, group_by: "weekday" })
    const breakdown = summary.breakdown as { weekday: string; avg_orders_per_day: number }[]
    const weakest = [...breakdown].sort((first, second) => first.avg_orders_per_day - second.avg_orders_per_day)[0]

    expect(breakdown).toHaveLength(7)
    expect(weakest?.weekday).toBe("tuesday")
  })

  it("compares with the previous period of the same length", async () => {
    const summary = await getSalesSummary(db, { compare_with_previous_period: true })

    expect(summary.previous_period?.period).toEqual({ start_date: "2026-08-31", end_date: "2026-09-27", days: 28 })
    expect(summary.previous_period?.change_percent.orders).toEqual(expect.any(Number))
  })

  it("rejects an inverted date range", async () => {
    await expect(getSalesSummary(db, { start_date: "2026-10-10", end_date: "2026-10-01" })).rejects.toThrow(
      "must be on or before",
    )
  })

  it("rejects impossible dates", async () => {
    await expect(getSalesSummary(db, { start_date: "2026-02-31" })).rejects.toThrow("YYYY-MM-DD")
  })
})

describe("analyze_reviews", () => {
  it("surfaces cold food as the main lasagna complaint in the last four weeks", async () => {
    const result = await analyzeReviews(db, { menu_item_id: lasagnaMenuItemId })

    expect(result.menu_item?.name).toBe("Lasanha à bolonhesa")
    expect(result.complaints[0]?.category).toBe("cold_food")
    expect(result.avg_rating).toBeLessThan(3.5)
  })

  it("rejects unknown menu items", async () => {
    await expect(analyzeReviews(db, { menu_item_id: 999 })).rejects.toThrow("list_menu_items")
  })
})

describe("classifyComment", () => {
  it.each([
    ["A lasanha chegou fria, decepcionante.", ["cold_food"]],
    ["Atrasou mais de uma hora.", ["late_delivery"]],
    ["Faltou o refrigerante.", ["wrong_or_missing_item"]],
    ["Molho derramou na sacola, embalagem ruim.", ["packaging"]],
    ["Muito salgado.", ["taste"]],
    ["Chegou quentinho e bem embalado.", []],
    [null, []],
  ])("classifies %j", (comment, categories) => {
    expect(classifyComment(comment)).toEqual(categories)
  })
})
