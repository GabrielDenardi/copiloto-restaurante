export type MenuCategory = "main" | "starter" | "dessert" | "drink"

export type MenuItem = {
  id: number
  name: string
  category: MenuCategory
  priceCents: number
  prepMinutes: number
  popularity: number
}

export const restaurant = {
  name: "Cantina Nonna Rosa",
  cuisine: "italiana",
  city: "Campinas",
} as const

export const lasagnaMenuItemId = 1

export const menuItems: MenuItem[] = [
  { id: 1, name: "Lasanha à bolonhesa", category: "main", priceCents: 4990, prepMinutes: 25, popularity: 9 },
  { id: 2, name: "Nhoque ao sugo", category: "main", priceCents: 3990, prepMinutes: 18, popularity: 6 },
  { id: 3, name: "Espaguete à carbonara", category: "main", priceCents: 4490, prepMinutes: 16, popularity: 8 },
  { id: 4, name: "Parmegiana de frango", category: "main", priceCents: 4790, prepMinutes: 22, popularity: 10 },
  { id: 5, name: "Risoto de cogumelos", category: "main", priceCents: 5290, prepMinutes: 24, popularity: 4 },
  { id: 6, name: "Filé ao molho madeira", category: "main", priceCents: 5990, prepMinutes: 20, popularity: 5 },
  { id: 7, name: "Polpetone recheado", category: "main", priceCents: 4290, prepMinutes: 22, popularity: 5 },
  { id: 8, name: "Bruschetta tradicional", category: "starter", priceCents: 2490, prepMinutes: 10, popularity: 5 },
  { id: 9, name: "Arancini de queijo", category: "starter", priceCents: 2690, prepMinutes: 12, popularity: 4 },
  { id: 10, name: "Tiramisù", category: "dessert", priceCents: 2290, prepMinutes: 5, popularity: 6 },
  { id: 11, name: "Petit gâteau", category: "dessert", priceCents: 2190, prepMinutes: 12, popularity: 5 },
  { id: 12, name: "Refrigerante lata", category: "drink", priceCents: 790, prepMinutes: 1, popularity: 9 },
  { id: 13, name: "Suco natural de laranja", category: "drink", priceCents: 1190, prepMinutes: 4, popularity: 5 },
  { id: 14, name: "Água sem gás", category: "drink", priceCents: 490, prepMinutes: 1, popularity: 4 },
  { id: 15, name: "Cerveja long neck", category: "drink", priceCents: 1290, prepMinutes: 1, popularity: 6 },
]
