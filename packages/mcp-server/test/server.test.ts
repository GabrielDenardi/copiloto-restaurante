import { openDatabase, type Database } from "@copiloto/data"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer } from "../src/index.ts"

let db: Database
let client: Client

beforeAll(async () => {
  db = await openDatabase()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createServer(db).connect(serverTransport)
  client = new Client({ name: "test-client", version: "0.0.0" })
  await client.connect(clientTransport)
})

afterAll(async () => {
  await client.close()
  await db.close()
})

const firstText = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])[0]!.text

describe("MCP server", () => {
  it("exposes the five tools", async () => {
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "analyze_reviews",
      "detect_anomalies",
      "draft_campaign",
      "get_sales_summary",
      "list_menu_items",
    ])
  })

  it("marks only draft_campaign as a write", async () => {
    const { tools } = await client.listTools()
    const writers = tools.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name)

    expect(writers).toEqual(["draft_campaign"])
  })

  it("answers tool calls with compact JSON", async () => {
    const result = await client.callTool({ name: "get_sales_summary", arguments: { group_by: "weekday" } })
    const payload = JSON.parse(firstText(result))

    expect(result.isError).toBeFalsy()
    expect(payload.breakdown).toHaveLength(7)
  })

  it("returns a tool error for invalid arguments", async () => {
    const result = await client.callTool({
      name: "draft_campaign",
      arguments: { name: "Queima", goal: "Vender mais", discount_percent: 80 },
    })

    expect(result.isError).toBe(true)
  })

  it("returns a tool error when the handler fails", async () => {
    const result = await client.callTool({ name: "analyze_reviews", arguments: { menu_item_id: 999 } })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("list_menu_items")
  })
})
