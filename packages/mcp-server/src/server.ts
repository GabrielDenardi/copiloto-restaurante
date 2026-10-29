import type { Database } from "@copiloto/data"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { detectAnomalies, detectAnomaliesShape } from "./tools/anomalies.ts"
import { draftCampaign, draftCampaignShape } from "./tools/draft-campaign.ts"
import { listMenuItems } from "./tools/list-menu-items.ts"
import { analyzeReviews, analyzeReviewsShape } from "./tools/reviews.ts"
import { getSalesSummary, salesSummaryShape } from "./tools/sales-summary.ts"

const readOnly = { readOnlyHint: true, openWorldHint: false } as const

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
})

export function createServer(db: Database): McpServer {
  const server = new McpServer({ name: "copiloto-restaurante", version: "0.1.0" })

  server.registerTool(
    "list_menu_items",
    {
      title: "List menu items",
      description:
        "Lists every menu item with its id, category and current price in BRL. Use it to map dish names the owner mentions to a menu_item_id.",
      annotations: readOnly,
    },
    async () => jsonResult(await listMenuItems(db)),
  )

  server.registerTool(
    "get_sales_summary",
    {
      title: "Get sales summary",
      description:
        "Returns orders, delivered and cancelled orders, cancellation rate, revenue and average ticket for a date range. Can break the totals down by day, weekday, hour or menu item and compare them with the previous period of the same length. Revenue only counts delivered orders.",
      inputSchema: salesSummaryShape,
      annotations: readOnly,
    },
    async (input) => jsonResult(await getSalesSummary(db, input)),
  )

  server.registerTool(
    "analyze_reviews",
    {
      title: "Analyze customer reviews",
      description:
        "Summarizes customer reviews for a date range: average rating, rating distribution, complaint categories (cold_food, late_delivery, wrong_or_missing_item, packaging, taste) with recent examples, and the weekly rating trend. Can be limited to orders that contained one menu item.",
      inputSchema: analyzeReviewsShape,
      annotations: readOnly,
    },
    async (input) => jsonResult(await analyzeReviews(db, input)),
  )

  server.registerTool(
    "detect_anomalies",
    {
      title: "Detect anomalies",
      description:
        "Scans a date range for unusual days (orders, cancellation rate, prep time vs the same weekday in previous weeks), weekdays whose orders shifted against the previous period, and menu items whose rating dropped. Use it first when the owner asks what is wrong or why results changed.",
      inputSchema: detectAnomaliesShape,
      annotations: readOnly,
    },
    async (input) => jsonResult(await detectAnomalies(db, input)),
  )

  server.registerTool(
    "draft_campaign",
    {
      title: "Draft a discount campaign",
      description:
        "Saves a discount campaign as a draft pending the owner's approval and returns how many delivered orders happened in that slot in the last 28 days. It never publishes anything.",
      inputSchema: draftCampaignShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(await draftCampaign(db, input)),
  )

  return server
}
