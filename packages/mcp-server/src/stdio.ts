import { defaultDataDir, openDatabase } from "@copiloto/data"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createServer } from "./server.ts"

const db = await openDatabase({ dataDir: process.env.COPILOTO_DATA_DIR ?? defaultDataDir })
await createServer(db).connect(new StdioServerTransport())
