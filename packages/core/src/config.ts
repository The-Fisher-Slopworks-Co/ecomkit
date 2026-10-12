import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { EcomError } from "./errors.ts";
import type { SpendingLimits } from "./guard.ts";
import { fromMajor, type Money } from "./money.ts";

type Env = Readonly<Record<string, string | undefined>>;

export interface EcomPaths {
  readonly configFile: string;
  readonly stateFile: string;
}

export interface EcomConfig {
  readonly limits: SpendingLimits;
}

const APP = "ecomkit";

export const defaultLimits: SpendingLimits = {
  perOrder: fromMajor(5_000),
  perDay: fromMajor(10_000),
};

export function ecomPaths(env: Env = process.env): EcomPaths {
  const home = homedir();
  const configDir = env["XDG_CONFIG_HOME"] || join(home, ".config");
  const stateDir = env["XDG_STATE_HOME"] || join(home, ".local", "state");
  return {
    configFile: join(configDir, APP, "config.json"),
    stateFile: join(stateDir, APP, "guard.json"),
  };
}

export async function loadConfig(
  env: Env = process.env,
  paths: EcomPaths = ecomPaths(env),
): Promise<EcomConfig> {
  const file = await readConfigFile(paths.configFile);
  const limits = isRecord(file["limits"]) ? file["limits"] : {};
  return {
    limits: {
      perOrder: tighter(
        limit(limits["perOrder"], defaultLimits.perOrder, "perOrder"),
        limit(env["ECOM_LIMIT_PER_ORDER"], undefined, "ECOM_LIMIT_PER_ORDER"),
      ),
      perDay: tighter(
        limit(limits["perDay"], defaultLimits.perDay, "perDay"),
        limit(env["ECOM_LIMIT_PER_DAY"], undefined, "ECOM_LIMIT_PER_DAY"),
      ),
    },
  };
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EcomError("invalid_input", `${path} is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new EcomError("invalid_input", `${path} must hold a JSON object`);
  }
  return parsed;
}

function limit<T extends Money | undefined>(
  raw: unknown,
  fallback: T,
  name: string,
): Money | T {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new EcomError(
      "invalid_input",
      `Spending limit ${name} must be a number of rubles, got ${JSON.stringify(raw)}`,
    );
  }
  try {
    return fromMajor(raw);
  } catch {
    throw new EcomError(
      "invalid_input",
      `Spending limit ${name} must be a non-negative number of rubles, got ${JSON.stringify(raw)}`,
    );
  }
}

function tighter(base: Money, override: Money | undefined): Money {
  return override !== undefined && override.amount < base.amount
    ? override
    : base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
