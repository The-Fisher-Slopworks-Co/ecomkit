import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runtime = process.env.ECOM_RUNTIME ?? "node";
const bundle =
  process.env.ECOM_BUNDLE ??
  fileURLToPath(new URL("../dist/ecom.js", import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const home = mkdtempSync(join(tmpdir(), "ecom-smoke-"));
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_STATE_HOME: join(home, "state"),
};

const ecom = (...args) =>
  execFileSync(runtime, [bundle, ...args], { env, encoding: "utf8" }).trim();

try {
  assert.equal(ecom("--version"), pkg.version);
  assert.match(
    JSON.parse(ecom("doctor", "--json")).runtime,
    new RegExp(`^${runtime} `),
  );
  assert.equal(
    JSON.parse(ecom("mock", "search", "молоко", "--json")).items.length,
    2,
  );

  const client = new Client({ name: "smoke", version: pkg.version });
  await client.connect(
    new StdioClientTransport({ command: runtime, args: [bundle, "mcp"], env }),
  );
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };

  assert.equal((await client.listTools()).tools.length, 9);
  await call("cart_set", {
    provider: "mock",
    product_id: "milk-1",
    quantity: 1,
  });
  const preview = await call("checkout", { provider: "mock" });
  assert.equal(preview.status, "needs_confirmation");
  const placed = await call("checkout", {
    provider: "mock",
    confirmation_code: preview.confirmationCode,
  });
  assert.equal(placed.status, "placed");
  await client.close();

  const state = readFileSync(
    join(home, "state", "ecomkit", "guard.json"),
    "utf8",
  );
  assert.match(state, /"orderId":"mock-1"/);

  console.log(`smoke ok on ${runtime}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
