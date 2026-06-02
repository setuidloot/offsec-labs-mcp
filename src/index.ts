#!/usr/bin/env node
/**
 * OffSec MCP server entry point.
 *
 * Manages YOUR OWN authorized OffSec Proving Grounds (PG Play) labs: list,
 * inspect, start/stop, status, connection info, and walkthrough access.
 *
 * Auth is via a session token/cookie copied from your logged-in browser:
 *   OFFSEC_BEARER_TOKEN   and/or   OFFSEC_COOKIE
 *
 * Transport: stdio by default (TRANSPORT=http for streamable HTTP on PORT).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerTools } from "./tools/index.js";

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must not log to stdout; use stderr.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

async function runHttp(): Promise<void> {
  const { default: express } = await import("express");
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  // Bind to localhost for safety (DNS-rebinding mitigation for local use).
  app.listen(port, "127.0.0.1", () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} on http://127.0.0.1:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";
const runner = transport === "http" ? runHttp : runStdio;
runner().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
