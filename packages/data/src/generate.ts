import { addDays, eachDay, formatTimestamp, weekdayOf } from "./dates.ts"
import { lasagnaMenuItemId, menuItems, restaurant, type MenuCategory, type MenuItem } from "./menu.ts"
import { createRandom, type Random } from "./random.ts"
import {
  coldLasagnaComments,
  complaintComments,
  neutralComments,
  praiseComments,
  type ComplaintCategory,
} from "./review-comments.ts"

export type OrderStatus = "delivered" | "cancelled"

export type Order = {
  id: number
  placedAt: string
  status: OrderStatus
  cancelReason: string | null
  prepMinutes: number
  deliveryMinutes: number | null
  totalCents: number
}

export type OrderItem = {
  orderId: number
  menuItemId: number
  quantity: number
  unitPriceCents: number
}

export type Review = {
  id: number
  orderId: number
  createdAt: string
  rating: number
  comment: string | null
}

export type PlantedPatterns = {
  tuesdayDrop: { from: string; to: string; ordersMultiplier: number }
  coldLasagna: { from: string; to: string; menuItemId: number; complaintProbability: number }
  kitchenIncident: { date: string; cancellationProbability: number; extraPrepMinutes: readonly [number, number] }
}

export type Dataset = {
  restaurant: typeof restaurant
  period: { start: string; end: string }
  menuItems: MenuItem[]
  orders: Order[]
  orderItems: OrderItem[]
  reviews: Review[]
  plantedPatterns: PlantedPatterns
}

export type GenerateOptions = {
  seed?: number
  endDate?: string
  days?: number
}

const baseOrdersByWeekday = [105, 55, 62, 66, 76, 112, 124]
const lunchHours = [[11, 2], [12, 5], [13, 4], [14, 1]] as const
const dinnerHours = [[18, 1], [19, 3], [20, 5], [21, 4], [22, 2], [23, 1]] as const
const regularCancelReasons = ["cliente desistiu", "endereço não encontrado", "item indisponível"]
const regularCancellationProbability = 0.03
const reviewProbability = 0.3
const lateThresholdMinutes = 65

const occasionalComplaints: readonly (readonly [ComplaintCategory, number, readonly [number, number]])[] = [
  ["wrong_or_missing_item", 0.04, [1, 2]],
  ["packaging", 0.02, [2, 3]],
  ["taste", 0.03, [2, 3]],
  ["cold_food", 0.03, [2, 3]],
]
const neutralProbability = 0.1

const popularityOf = (category: MenuCategory) =>
  menuItems
    .filter((item) => item.category === category)
    .map((item) => [item, item.popularity] as const)

const mainEntries = popularityOf("main")
const starterEntries = popularityOf("starter")
const dessertEntries = popularityOf("dessert")
const drinkEntries = popularityOf("drink")

export function generateDataset(options: GenerateOptions = {}): Dataset {
  const seed = options.seed ?? 42
  const end = options.endDate ?? "2026-10-25"
  const days = options.days ?? 90
  const start = addDays(end, -(days - 1))
  const random = createRandom(seed)

  const plantedPatterns: PlantedPatterns = {
    tuesdayDrop: { from: addDays(end, -27), to: end, ordersMultiplier: 0.6 },
    coldLasagna: { from: addDays(end, -30), to: end, menuItemId: lasagnaMenuItemId, complaintProbability: 0.55 },
    kitchenIncident: { date: addDays(end, -8), cancellationProbability: 0.25, extraPrepMinutes: [20, 35] },
  }

  const orders: Order[] = []
  const orderItems: OrderItem[] = []
  const reviews: Review[] = []

  eachDay(start, end).forEach((day, dayIndex) => {
    const weekday = weekdayOf(day)
    const growth = 1 + 0.08 * (dayIndex / days)
    const noise = 0.9 + random.next() * 0.2
    const isTuesdayDrop = weekday === 2 && day >= plantedPatterns.tuesdayDrop.from
    const dropMultiplier = isTuesdayDrop ? plantedPatterns.tuesdayDrop.ordersMultiplier : 1
    const orderCount = Math.round(baseOrdersByWeekday[weekday]! * growth * noise * dropMultiplier)
    const isIncidentDay = day === plantedPatterns.kitchenIncident.date
    const isColdLasagnaPeriod = day >= plantedPatterns.coldLasagna.from

    const minutes = Array.from({ length: orderCount }, () => pickOrderMinute(random, weekday)).sort(
      (first, second) => first - second,
    )

    for (const minute of minutes) {
      const orderId = orders.length + 1
      const items = pickItems(random)
      const basePrep = Math.max(...[...items.keys()].map((item) => item.prepMinutes)) + random.int(0, 8)
      const prepMinutes = isIncidentDay
        ? basePrep + random.int(...plantedPatterns.kitchenIncident.extraPrepMinutes)
        : basePrep
      const cancelReason = pickCancelReason(random, isIncidentDay, plantedPatterns)
      const status: OrderStatus = cancelReason ? "cancelled" : "delivered"
      const deliveryMinutes = status === "delivered" ? random.int(15, 35) : null
      const totalCents = [...items].reduce((sum, [item, quantity]) => sum + item.priceCents * quantity, 0)

      orders.push({
        id: orderId,
        placedAt: formatTimestamp(day, minute),
        status,
        cancelReason,
        prepMinutes,
        deliveryMinutes,
        totalCents,
      })

      for (const [item, quantity] of items) {
        orderItems.push({ orderId, menuItemId: item.id, quantity, unitPriceCents: item.priceCents })
      }

      if (deliveryMinutes === null || !random.chance(reviewProbability)) continue

      const hasLasagna = [...items.keys()].some((item) => item.id === lasagnaMenuItemId)
      const review = writeReview(random, {
        items: [...items.keys()],
        hasColdLasagna: hasLasagna && isColdLasagnaPeriod,
        coldLasagnaProbability: plantedPatterns.coldLasagna.complaintProbability,
        wasLate: prepMinutes + deliveryMinutes > lateThresholdMinutes,
      })

      reviews.push({
        id: reviews.length + 1,
        orderId,
        createdAt: formatTimestamp(day, minute + prepMinutes + deliveryMinutes + random.int(10, 120)),
        ...review,
      })
    }
  })

  return {
    restaurant,
    period: { start, end },
    menuItems,
    orders,
    orderItems,
    reviews,
    plantedPatterns,
  }
}

function pickOrderMinute(random: Random, weekday: number): number {
  const lunchShare = weekday === 0 ? 0.6 : 0.4
  const hour = random.chance(lunchShare) ? random.weighted(lunchHours) : random.weighted(dinnerHours)
  return hour * 60 + random.int(0, 59)
}

function pickItems(random: Random): Map<MenuItem, number> {
  const quantities = new Map<MenuItem, number>()
  const add = (item: MenuItem, quantity = 1) => quantities.set(item, (quantities.get(item) ?? 0) + quantity)
  const mainCount = random.chance(0.2) ? 2 : 1

  for (let index = 0; index < mainCount; index++) add(random.weighted(mainEntries))
  if (random.chance(0.15)) add(random.weighted(starterEntries))
  if (random.chance(0.22)) add(random.weighted(dessertEntries))
  if (random.chance(0.55)) add(random.weighted(drinkEntries), mainCount)

  return quantities
}

function pickCancelReason(random: Random, isIncidentDay: boolean, patterns: PlantedPatterns): string | null {
  if (isIncidentDay && random.chance(patterns.kitchenIncident.cancellationProbability)) {
    return "tempo de preparo excedido"
  }
  return random.chance(regularCancellationProbability) ? random.pick(regularCancelReasons) : null
}

type ReviewContext = {
  items: MenuItem[]
  hasColdLasagna: boolean
  coldLasagnaProbability: number
  wasLate: boolean
}

function writeReview(random: Random, context: ReviewContext): Pick<Review, "rating" | "comment"> {
  const featuredItem = context.items.find((item) => item.category === "main") ?? context.items[0]!

  if (context.hasColdLasagna && random.chance(context.coldLasagnaProbability)) {
    return { rating: random.int(1, 2), comment: random.pick(coldLasagnaComments) }
  }

  if (context.wasLate && random.chance(0.5)) {
    return complaint(random, "late_delivery", featuredItem, [1, 3])
  }

  let roll = random.next()
  for (const [category, probability, ratingRange] of occasionalComplaints) {
    if (roll < probability) return complaint(random, category, featuredItem, ratingRange)
    roll -= probability
  }

  if (roll < neutralProbability) {
    return { rating: 3, comment: fillTemplate(random.pick(neutralComments), featuredItem) }
  }

  return {
    rating: random.chance(0.7) ? 5 : 4,
    comment: random.chance(0.25) ? null : fillTemplate(random.pick(praiseComments), featuredItem),
  }
}

function complaint(
  random: Random,
  category: ComplaintCategory,
  item: MenuItem,
  [minRating, maxRating]: readonly [number, number],
): Pick<Review, "rating" | "comment"> {
  return {
    rating: random.int(minRating, maxRating),
    comment: fillTemplate(random.pick(complaintComments[category]), item),
  }
}

function fillTemplate(template: string, item: MenuItem): string {
  const text = template.replace("{item}", item.name.toLocaleLowerCase("pt-BR"))
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1)
}
