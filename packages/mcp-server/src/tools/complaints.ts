import { complaintCategories, type ComplaintCategory } from "@copiloto/data"
import { ratio, roundTo } from "./shared.ts"

const complaintPatterns: Record<ComplaintCategory, RegExp> = {
  cold_food: /\b(fri[oa]s?|gelad[oa]s?)\b/,
  late_delivery: /\b(demor\w*|atras\w*)/,
  wrong_or_missing_item: /\b(errad\w*|falt\w*|esquec\w*)/,
  packaging: /\b(embalagem|vazou|derram\w*)/,
  taste: /\b(salgad\w*|sem sabor|passou do ponto|insoss\w*)/,
}

export function classifyComment(comment: string | null): ComplaintCategory[] {
  if (!comment) return []
  const normalized = comment.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  return complaintCategories.filter((category) => complaintPatterns[category].test(normalized))
}

export function topComplaint(comments: (string | null)[]) {
  const counts = new Map<ComplaintCategory, number>()
  for (const category of comments.flatMap(classifyComment)) counts.set(category, (counts.get(category) ?? 0) + 1)

  const [top] = [...counts].sort(([, first], [, second]) => second - first)
  if (!top) return null

  const [category, count] = top
  return { category, share_of_reviews: roundTo(ratio(count, comments.length), 3) }
}
