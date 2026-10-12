import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.ts";
import { testRuntime } from "./test-runtime.ts";

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(testRuntime(), "0.0.0-test").connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return {
      isError: result.isError === true,
      data: JSON.parse(content?.text ?? "null"),
    };
  };
  return { client, call };
}

describe("MCP server", () => {
  test("exposes nine tools, only checkout and command are destructive", async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      "cart",
      "cart_set",
      "checkout",
      "command",
      "order",
      "orders",
      "product",
      "providers",
      "search",
    ]);
    const destructive = tools
      .filter((tool) => tool.annotations?.destructiveHint !== false)
      .map((tool) => tool.name);
    expect(destructive.toSorted()).toEqual(["checkout", "command"]);
  });

  test("checks out in two calls bound to the cart", async () => {
    const { call } = await connect();

    await call("cart_set", {
      provider: "mock",
      product_id: "bread-1",
      quantity: 2,
    });
    const preview = await call("checkout", { provider: "mock" });
    expect(preview.data).toMatchObject({
      status: "needs_confirmation",
      preview: { total: { amount: 17980, currency: "RUB" } },
    });

    await call("cart_set", {
      provider: "mock",
      product_id: "bread-1",
      quantity: 3,
    });
    const stale = await call("checkout", {
      provider: "mock",
      confirmation_code: preview.data.confirmationCode,
    });
    expect(stale.isError).toBe(true);
    expect(stale.data.error.code).toBe("confirmation_required");

    const fresh = await call("checkout", { provider: "mock" });
    const placed = await call("checkout", {
      provider: "mock",
      confirmation_code: fresh.data.confirmationCode,
    });
    expect(placed.data).toMatchObject({
      status: "placed",
      order: { id: "mock-1" },
    });
    expect(
      (await call("order", { provider: "mock", id: "mock-1" })).data.status,
    ).toBe("created");
  });

  test("returns provider errors as tool errors", async () => {
    const { call } = await connect();

    const unsupported = await call("cart", { provider: "board" });
    const unknown = await call("search", { provider: "ozon", query: "x" });

    expect(unsupported).toMatchObject({
      isError: true,
      data: { error: { code: "unsupported" } },
    });
    expect(unknown.data.error.code).toBe("unknown_provider");
  });

  test("runs provider commands", async () => {
    const { call } = await connect();

    const { data } = await call("command", {
      provider: "board",
      name: "messages",
      args: ["inbox"],
    });

    expect(data).toEqual({ messages: [], args: ["inbox"] });
  });

  test("lists providers with capabilities and commands", async () => {
    const { call } = await connect();

    const { data } = await call("providers");

    expect(data).toContainEqual(
      expect.objectContaining({
        id: "board",
        capabilities: ["search"],
        commands: [{ name: "messages", description: "List chat messages" }],
      }),
    );
  });
});
