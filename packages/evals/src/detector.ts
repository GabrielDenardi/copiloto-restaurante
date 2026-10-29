import { generateDataset, lasagnaMenuItemId, openDatabase, resetDatabase, type PlantedPatterns } from "@copiloto/data"
import { detectAnomalies } from "@copiloto/mcp-server"
import { parseArgs } from "node:util"

type Anomaly = Awaited<ReturnType<typeof detectAnomalies>>["anomalies"][number]
type PatternName = keyof PlantedPatterns

const patternLabels: Record<PatternName, string> = {
  tuesdayDrop: "Queda nas terças",
  coldLasagna: "Lasanha chegando fria",
  kitchenIncident: "Incidente na cozinha",
}

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "100" },
    "max-false-alarm-rate": { type: "string", default: "0.02" },
  },
})

const seedCount = Number(values.seeds)
const maxFalseAlarmRate = Number(values["max-false-alarm-rate"])

const detections: Record<PatternName, number> = { tuesdayDrop: 0, coldLasagna: 0, kitchenIncident: 0 }
const falseAlarms: string[] = []
const lasagnaZScores: number[] = []

const db = await openDatabase({ dataset: generateDataset({ seed: 1 }) })

for (let seed = 1; seed <= seedCount; seed++) {
  const dataset = generateDataset({ seed })
  if (seed > 1) await resetDatabase(db, dataset)
  const { anomalies } = await detectAnomalies(db)

  const patterns = dataset.plantedPatterns
  const found = new Set(anomalies.map((anomaly) => explainedBy(anomaly, patterns)))

  if (found.has("tuesdayDrop")) detections.tuesdayDrop += 1
  if (found.has("coldLasagna")) detections.coldLasagna += 1
  if (found.has("kitchenIncident")) detections.kitchenIncident += 1

  for (const anomaly of anomalies) {
    if (explainedBy(anomaly, patterns) === null) falseAlarms.push(`seed ${seed}: ${anomaly.description}`)
    if (anomaly.type === "menu_item_rating_drop" && anomaly.menu_item?.id === lasagnaMenuItemId) {
      lasagnaZScores.push(anomaly.z_score ?? 0)
    }
  }
}

await db.close()

const falseAlarmRate = falseAlarms.length / seedCount
const missedPattern = Object.values(detections).some((count) => count < seedCount)

console.log(`Detector de anomalias em ${seedCount} seeds\n`)
console.table(
  Object.fromEntries(
    (Object.keys(patternLabels) as PatternName[]).map((pattern) => [
      patternLabels[pattern],
      { detectado: `${detections[pattern]}/${seedCount}` },
    ]),
  ),
)
console.log(`Menor z-score da lasanha: ${Math.min(...lasagnaZScores)}`)
console.log(`Alarmes falsos: ${falseAlarms.length} (${(falseAlarmRate * 100).toFixed(1)}% das execuções)`)
for (const alarm of falseAlarms) console.log(`  - ${alarm}`)

if (missedPattern || falseAlarmRate > maxFalseAlarmRate) {
  console.error(
    `\nReprovado: todo padrão precisa ser detectado em todas as seeds e a taxa de alarmes falsos deve ficar em até ${maxFalseAlarmRate * 100}%.`,
  )
  process.exitCode = 1
}

function explainedBy(anomaly: Anomaly, patterns: PlantedPatterns): PatternName | null {
  if (anomaly.type === "weekday_orders_shift" && anomaly.weekday === "tuesday") return "tuesdayDrop"
  if (anomaly.type === "daily_orders" && anomaly.weekday === "tuesday" && anomaly.date! >= patterns.tuesdayDrop.from) {
    return "tuesdayDrop"
  }
  if (anomaly.type === "menu_item_rating_drop" && anomaly.menu_item?.id === patterns.coldLasagna.menuItemId) {
    return "coldLasagna"
  }
  if (
    (anomaly.type === "daily_cancellation_rate" || anomaly.type === "daily_prep_time") &&
    anomaly.date === patterns.kitchenIncident.date
  ) {
    return "kitchenIncident"
  }
  return null
}
