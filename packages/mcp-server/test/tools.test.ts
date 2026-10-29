import { generateDataset, lasagnaMenuItemId, openDatabase, type Database } from "@copiloto/data"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { analyzeReviews, classifyComment, detectAnomalies, getSalesSummary, listMenuItems } from "../src/index.ts"

const dataset = generateDataset()
const { tuesdayDrop, kitchenIncident } = dataset.plantedPatterns
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

describe("detect_anomalies", () => {
  it("finds every planted pattern in the last four weeks", async () => {
    const { anomalies } = await detectAnomalies(db)

    expect(anomalies).toContainEqual(expect.objectContaining({ type: "weekday_orders_shift", weekday: "tuesday" }))
    expect(anomalies).toContainEqual(
      expect.objectContaining({ type: "daily_cancellation_rate", date: kitchenIncident.date, severity: "high" }),
    )
    expect(anomalies).toContainEqual(expect.objectContaining({ type: "daily_prep_time", date: kitchenIncident.date }))
    expect(anomalies).toContainEqual(
      expect.objectContaining({
        type: "menu_item_rating_drop",
        menu_item: { id: lasagnaMenuItemId, name: "Lasanha à bolonhesa" },
        top_complaint: expect.objectContaining({ category: "cold_food" }),
      }),
    )
  })

  it("does not flag weekdays or dishes that were not planted", async () => {
    const { anomalies } = await detectAnomalies(db)

    const shiftedWeekdays = anomalies.filter((anomaly) => anomaly.type === "weekday_orders_shift")
    const droppedItems = anomalies.filter((anomaly) => anomaly.type === "menu_item_rating_drop")

    expect(shiftedWeekdays.map((anomaly) => anomaly.weekday)).toEqual(["tuesday"])
    expect(droppedItems.map((anomaly) => anomaly.menu_item?.id)).toEqual([lasagnaMenuItemId])
  })

  it("does not flag cancellation or prep spikes outside the incident day", async () => {
    const { anomalies } = await detectAnomalies(db)
    const kitchenSpikes = anomalies.filter(
      (anomaly) => anomaly.type === "daily_cancellation_rate" || anomaly.type === "daily_prep_time",
    )

    expect(new Set(kitchenSpikes.map((anomaly) => anomaly.date))).toEqual(new Set([kitchenIncident.date]))
  })

  it.each([1, 7, 13, 21, 99])("finds only the planted patterns with seed %i", async (seed) => {
    const seededDataset = generateDataset({ seed })
    const seededDb = await openDatabase({ dataset: seededDataset })
    const { anomalies } = await detectAnomalies(seededDb)
    await seededDb.close()

    const found = (type: string) => anomalies.filter((anomaly) => anomaly.type === type)
    const incidentDate = seededDataset.plantedPatterns.kitchenIncident.date

    expect(found("weekday_orders_shift").map((anomaly) => anomaly.weekday)).toEqual(["tuesday"])
    expect(found("menu_item_rating_drop").map((anomaly) => anomaly.menu_item?.id)).toEqual([lasagnaMenuItemId])
    expect(found("daily_cancellation_rate").map((anomaly) => anomaly.date)).toEqual([incidentDate])
    expect(found("daily_prep_time").map((anomaly) => anomaly.date)).toEqual([incidentDate])
    expect(found("daily_orders").every((anomaly) => anomaly.weekday === "tuesday")).toBe(true)
  })

  it("only checks daily spikes on short windows", async () => {
    const result = await detectAnomalies(db, { start_date: "2026-10-20", end_date: "2026-10-25" })

    expect(result.notes).toHaveLength(1)
    expect(result.anomalies.every((anomaly) => anomaly.type.startsWith("daily_"))).toBe(true)
  })
})
