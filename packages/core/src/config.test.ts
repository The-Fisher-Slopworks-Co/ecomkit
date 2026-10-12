import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLimits, ecomPaths, loadConfig } from "./config.ts";
import { fromMajor } from "./money.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ecomkit-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(content: string) {
  await mkdir(join(dir, "ecomkit"), { recursive: true });
  await writeFile(join(dir, "ecomkit", "config.json"), content);
}

describe("config", () => {
  test("follows XDG directories", () => {
    expect(ecomPaths({ XDG_CONFIG_HOME: "/c", XDG_STATE_HOME: "/s" })).toEqual({
      configFile: "/c/ecomkit/config.json",
      stateFile: "/s/ecomkit/guard.json",
    });
  });

  test("defaults the limits when there is no config file", async () => {
    expect(await loadConfig({ XDG_CONFIG_HOME: dir })).toEqual({
      limits: defaultLimits,
    });
  });

  test("reads limits in rubles, the environment can only lower them", async () => {
    await writeConfig('{ "limits": { "perOrder": 3000, "perDay": 8000.5 } }');

    expect(
      await loadConfig({
        XDG_CONFIG_HOME: dir,
        ECOM_LIMIT_PER_ORDER: "1000",
        ECOM_LIMIT_PER_DAY: "90000",
      }),
    ).toEqual({
      limits: { perOrder: fromMajor(1_000), perDay: fromMajor("8000.50") },
    });
  });

  test.each([
    ["not json", "{"],
    ["not an object", "[]"],
    ["a negative limit", '{ "limits": { "perOrder": -1 } }'],
    ["a non-numeric limit", '{ "limits": { "perDay": "lots" } }'],
    ["a non-scalar limit", '{ "limits": { "perDay": [1] } }'],
  ])("rejects %s", async (_name, content) => {
    await writeConfig(content);

    await expect(loadConfig({ XDG_CONFIG_HOME: dir })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
