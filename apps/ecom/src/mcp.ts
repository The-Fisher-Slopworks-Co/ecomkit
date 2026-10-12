import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as actions from "./actions.ts";
import { errorPayload } from "./errors.ts";
import type { Runtime } from "./runtime.ts";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

async function respond(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await run();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(errorPayload(error)) }],
    };
  }
}

export function createMcpServer(runtime: Runtime, version: string): McpServer {
  const server = new McpServer({ name: "ecom", version });
  const provider = z
    .string()
    .describe(
      `Provider id, one of: ${[...runtime.providers.keys()].join(", ")}`,
    );

  server.registerTool(
    "providers",
    {
      title: "List providers",
      description:
        "List the available shops and delivery services with the capabilities and commands each supports.",
      annotations: { ...readOnly, openWorldHint: false },
    },
    () => respond(async () => actions.listProviders(runtime)),
  );

  server.registerTool(
    "search",
    {
      title: "Search products",
      description: "Search a provider's catalog. Prices are in minor units.",
      inputSchema: {
        provider,
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: readOnly,
    },
    (args) =>
      respond(() =>
        actions.search(runtime, args.provider, {
          text: args.query,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        }),
      ),
  );

  server.registerTool(
    "product",
    {
      title: "Get product",
      description: "Get one product by id.",
      inputSchema: { provider, id: z.string().min(1) },
      annotations: readOnly,
    },
    (args) => respond(() => actions.product(runtime, args.provider, args.id)),
  );

  server.registerTool(
    "cart",
    {
      title: "Get cart",
      description: "Show the current cart with totals.",
      inputSchema: { provider },
      annotations: readOnly,
    },
    (args) => respond(() => actions.cart(runtime, args.provider)),
  );

  server.registerTool(
    "cart_set",
    {
      title: "Set cart quantity",
      description:
        "Set the quantity of a product in the cart; 0 removes it. Returns the updated cart.",
      inputSchema: {
        provider,
        product_id: z.string().min(1),
        quantity: z.number().int().min(0),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) =>
      respond(() =>
        actions.setCartItem(
          runtime,
          args.provider,
          args.product_id,
          args.quantity,
        ),
      ),
  );

  server.registerTool(
    "checkout",
    {
      title: "Place order",
      description:
        "Place an order for the current cart and spend real money. Call it first without confirmation_code: it returns the preview, the spending limits and a single-use code valid for ten minutes. Show the preview to the user and call again with that code only after they explicitly approve. The code is tied to the exact cart, total and address.",
      inputSchema: {
        provider,
        confirmation_code: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) =>
      respond(() =>
        actions.checkout(runtime, args.provider, args.confirmation_code),
      ),
  );

  server.registerTool(
    "orders",
    {
      title: "List orders",
      description: "List recent orders, newest first.",
      inputSchema: { provider },
      annotations: readOnly,
    },
    (args) => respond(() => actions.orders(runtime, args.provider)),
  );

  server.registerTool(
    "order",
    {
      title: "Get order",
      description: "Get one order with its status.",
      inputSchema: { provider, id: z.string().min(1) },
      annotations: readOnly,
    },
    (args) => respond(() => actions.order(runtime, args.provider, args.id)),
  );

  server.registerTool(
    "command",
    {
      title: "Run provider command",
      description:
        "Run a provider-specific command listed by the providers tool, such as messages or listings. Commands may change data on the provider's side.",
      inputSchema: {
        provider,
        name: z.string().min(1),
        args: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) =>
      respond(() =>
        actions.runCommand(runtime, args.provider, args.name, args.args ?? []),
      ),
  );

  return server;
}

export async function serveStdio(
  runtime: Runtime,
  version: string,
): Promise<void> {
  await createMcpServer(runtime, version).connect(new StdioServerTransport());
}
