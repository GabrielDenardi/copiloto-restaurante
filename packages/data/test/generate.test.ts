import { describe, expect, it } from "vitest"
import { generateDataset, lasagnaMenuItemId, weekdayOf, type Dataset } from "../src/index.ts"

const dataset = generateDataset()
const orderDay = (placedAt: string) => placedAt.slice(0, 10)

function averageOrdersPerDay(data: Dataset, includeDay: (day: string) => boolean): number {
  const perDay = new Map<string, number>()
  for (const order of data.orders) {
    const day = orderDay(order.placedAt)
    if (includeDay(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
  return [...perDay.values()].reduce((sum, count) => sum + count, 0) / perDay.size
}

function lasagnaRating(includeDay: (day: string) => boolean): number {
  const lasagnaOrders = new Set(
    dataset.orderItems.filter((item) => item.menuItemId === lasagnaMenuItemId).map((item) => item.orderId),
  )
  const placedAt = new Map(dataset.orders.map((order) => [order.id, order.placedAt]))
  const ratings = dataset.reviews
    .filter((review) => lasagnaOrders.has(review.orderId) && includeDay(orderDay(placedAt.get(review.orderId)!)))
    .map((review) => review.rating)
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
}

describe("generateDataset", () => {
  it("is deterministic for the same seed", () => {
    expect(generateDataset()).toEqual(dataset)
  })

  it("changes with a different seed", () => {
    expect(generateDataset({ seed: 7 }).orders).not.toEqual(dataset.orders)
  })

  it("covers 90 consecutive days ending on the configured date", () => {
    expect(dataset.period).toEqual({ start: "2026-07-28", end: "2026-10-25" })
    expect(new Set(dataset.orders.map((order) => orderDay(order.placedAt))).size).toBe(90)
  })

  it("plants a drop in tuesday orders over the last four weeks", () => {
    const { from, ordersMultiplier } = dataset.plantedPatterns.tuesdayDrop
    const isTuesday = (day: string) => weekdayOf(day) === 2
    const before = averageOrdersPerDay(dataset, (day) => isTuesday(day) && day < from)
    const after = averageOrdersPerDay(dataset, (day) => isTuesday(day) && day >= from)

    expect(after / before).toBeCloseTo(ordersMultiplier, 1)
  })

  it("plants cold lasagna complaints that pull its rating down", () => {
    const { from } = dataset.plantedPatterns.coldLasagna

    expect(lasagnaRating((day) => day < from)).toBeGreaterThan(4)
    expect(lasagnaRating((day) => day >= from)).toBeLessThan(3.2)
  })

  it("plants a kitchen incident with cancellations and slow prep", () => {
    const { date } = dataset.plantedPatterns.kitchenIncident
    const incidentOrders = dataset.orders.filter((order) => orderDay(order.placedAt) === date)
    const otherOrders = dataset.orders.filter((order) => orderDay(order.placedAt) !== date)
    const cancellationRate = (orders: Dataset["orders"]) =>
      orders.filter((order) => order.status === "cancelled").length / orders.length

    expect(cancellationRate(incidentOrders)).toBeGreaterThan(0.15)
    expect(cancellationRate(otherOrders)).toBeLessThan(0.05)
  })
})
