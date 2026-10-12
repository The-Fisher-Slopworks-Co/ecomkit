import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.ts";
import type { Runtime } from "./runtime.ts";
import { memorySecretStore, testRuntime } from "./test-runtime.ts";

function harness(runtime: Runtime = testRuntime(), secrets: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  let served = false;
  const run = (...argv: string[]) =>
    runCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      readSecret: async () => secrets.shift() ?? "",
      createRuntime: async () => runtime,
      serveMcp: async () => {
        served = true;
      },
    });
  const json = () => JSON.parse(out.at(-1) ?? "null");
  return { run, out, err, json, served: () => served };
}

describe("ecom CLI", () => {
  test("prints usage and the version", async () => {
    const cli = harness();

    expect(await cli.run()).toBe(0);
    expect(cli.out[0]).toContain("ecom <provider> <command>");
    expect(await cli.run("--version")).toBe(0);
    expect(cli.out[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("walks search, cart and a confirmed checkout", async () => {
    const cli = harness();

    expect(await cli.run("mock", "search", "молоко", "--json")).toBe(0);
    expect(cli.json().items).toHaveLength(2);

    await cli.run("mock", "add", "milk-1", "--qty", "2");
    await cli.run("mock", "add", "milk-1", "--json");
    expect(cli.json().items[0].quantity).toBe(3);

    await cli.run("mock", "checkout");
    const preview = cli.out.at(-1) ?? "";
    expect(preview).toContain("Total: 389,70 ₽");
    expect(preview).toContain("Address: Test street 1");
    expect(preview).toContain(
      "Delivery window: 2026-10-12T18:00:00+03:00 – 2026-10-12T19:00:00+03:00",
    );
    expect(preview).toContain("Payment: Cash to the courier");
    const code = /--confirm (\w+)/.exec(preview)?.[1] ?? "";

    expect(await cli.run("mock", "checkout", "--confirm", code)).toBe(0);
    expect(cli.out.at(-1)).toBe("Order mock-1 placed: 389,70 ₽");
    expect(await cli.run("mock", "checkout", "--confirm", code)).toBe(1);

    await cli.run("mock", "orders", "--json");
    expect(cli.json().items.map((o: { id: string }) => o.id)).toEqual([
      "mock-1",
    ]);
  });

  test("reports errors as JSON with --json and on stderr otherwise", async () => {
    const cli = harness();

    expect(await cli.run("ozon", "search", "x", "--json")).toBe(1);
    expect(cli.json().error.code).toBe("unknown_provider");

    expect(await cli.run("board", "cart")).toBe(1);
    expect(cli.err.at(-1)).toBe("error: board does not support cart");

    expect(await cli.run("mock", "add", "milk-1", "--qty", "0", "--json")).toBe(
      1,
    );
    expect(cli.json().error.code).toBe("invalid_input");

    expect(await cli.run("--nope", "--json")).toBe(1);
    expect(cli.json().error.code).toBe("invalid_input");
  });

  test("runs provider-specific commands", async () => {
    const cli = harness();

    await cli.run("board", "messages", "inbox", "--json");

    expect(cli.json()).toEqual({ messages: [], args: ["inbox"] });

    expect(await cli.run("board", "constructor", "--json")).toBe(1);
    expect(cli.json().error.code).toBe("unsupported");
  });

  test("logs in, reports readiness and logs out", async () => {
    const keychain = memorySecretStore();
    const runtime = testRuntime(keychain);
    const cli = harness(runtime, ["  secret-token  "]);

    await cli.run("board", "search", "sofa", "--json");
    expect(cli.json().error).toMatchObject({ code: "auth_required" });

    expect(await cli.run("login", "board")).toBe(0);
    expect(keychain.values.get("board/token")).toBe("secret-token");

    await cli.run("doctor", "--json");
    expect(cli.json()).toMatchObject({
      secretStore: "env+memory",
      stateFile: "/state/guard.json",
      providers: [
        { id: "mock", secrets: {} },
        { id: "board", secrets: { token: true } },
        { id: "sms", secrets: { session: false } },
      ],
    });

    expect(await cli.run("board", "search", "sofa")).toBe(0);
    await cli.run("logout", "board");
    expect(keychain.values.size).toBe(0);
  });

  test("lets a provider run its own login and logs it out", async () => {
    const keychain = memorySecretStore();
    const cli = harness(testRuntime(keychain), ["79990000000", "1234"]);

    expect(await cli.run("login", "sms", "--json")).toBe(0);
    expect(cli.json()).toMatchObject({ provider: "sms", stored: ["session"] });
    expect(keychain.values.get("sms/session")).toBe("79990000000:1234");

    await cli.run("logout", "sms");
    expect(keychain.values.size).toBe(0);
  });

  test("refuses an empty secret", async () => {
    const cli = harness(testRuntime(), [""]);

    expect(await cli.run("login", "board", "--json")).toBe(1);
    expect(cli.json().error.code).toBe("invalid_input");
  });

  test("hands mcp over to the server", async () => {
    const cli = harness();

    expect(await cli.run("mcp")).toBe(0);
    expect(cli.served()).toBe(true);
  });
});
