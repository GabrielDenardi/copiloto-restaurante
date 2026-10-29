export const complaintCategories = [
  "cold_food",
  "late_delivery",
  "wrong_or_missing_item",
  "packaging",
  "taste",
] as const

export type ComplaintCategory = (typeof complaintCategories)[number]

export const praiseComments = [
  "Muito bom, chegou rapidinho!",
  "Comida deliciosa, porção caprichada.",
  "Perfeito como sempre.",
  "Chegou quentinho e bem embalado.",
  "Melhor {item} da região!",
  "{item} excelente, vou pedir de novo.",
  "Tudo certo, recomendo.",
  "Sabor de comida de vó.",
]

export const neutralComments = [
  "Bom, mas já foi melhor.",
  "Ok, nada de especial.",
  "Gostei, mas a porção de {item} poderia ser maior.",
]

export const complaintComments: Record<ComplaintCategory, string[]> = {
  cold_food: [
    "Chegou frio.",
    "Comida veio fria, tive que esquentar.",
    "O prato chegou gelado no meio.",
  ],
  late_delivery: [
    "Demorou demais pra chegar.",
    "Atrasou mais de uma hora.",
    "Muita demora, pedido chegou atrasado.",
  ],
  wrong_or_missing_item: [
    "Veio errado, pedi outro prato.",
    "Faltou o refrigerante.",
    "Esqueceram um item do pedido.",
  ],
  packaging: ["Embalagem vazou toda.", "Molho derramou na sacola, embalagem ruim."],
  taste: ["Muito salgado.", "{item} sem sabor nenhum.", "Massa passou do ponto."],
}

export const coldLasagnaComments = [
  "A lasanha chegou fria, decepcionante.",
  "Lasanha gelada no meio, parece que foi esquentada às pressas.",
  "Pedi a lasanha e veio fria de novo.",
  "Chegou frio.",
  "Comida veio fria, tive que esquentar.",
]
