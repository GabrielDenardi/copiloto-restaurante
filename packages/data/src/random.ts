export type Random = {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  weighted<T>(entries: readonly (readonly [T, number])[]): T
  chance(probability: number): boolean
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (entries) => {
      const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0)
      let roll = next() * totalWeight
      for (const [value, weight] of entries) {
        roll -= weight
        if (roll < 0) return value
      }
      return entries[entries.length - 1]![0]
    },
    chance: (probability) => next() < probability,
  }
}
