import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EcomError } from "./errors.ts";
import { formatMoney, money, type Money } from "./money.ts";
import type { Provider, ProviderContext } from "./provider.ts";
import type { CheckoutPreview, Order } from "./types.ts";

export interface SpendingLimits {
  readonly perOrder: Money;
  readonly perDay: Money;
}

export interface SpendRecord {
  readonly id: string;
  readonly provider: string;
  readonly at: string;
  status: "pending" | "placed" | "failed";
  total: Money;
  orderId?: string;
}

export interface Confirmation {
  readonly code: string;
  readonly provider: string;
  readonly digest: string;
  readonly issuedAt: string;
}

export interface GuardState {
  confirmations: Confirmation[];
  spend: SpendRecord[];
}

export interface GuardStore {
  transaction<T>(
    run: (state: GuardState, save: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

export class MemoryGuardStore implements GuardStore {
  readonly state: GuardState = { confirmations: [], spend: [] };
  #queue: Promise<unknown> = Promise.resolve();

  transaction<T>(
    run: (state: GuardState, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const result = this.#queue.then(() => run(this.state, async () => {}));
    this.#queue = result.catch(() => {});
    return result;
  }
}

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 25;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function abandoned(holder: string, ageMs: number): boolean {
  const [host, pid] = holder.split(":");
  const holderPid = Number(pid);
  if (host === hostname() && Number.isSafeInteger(holderPid) && holderPid > 0) {
    return !processAlive(holderPid);
  }
  return ageMs > LOCK_STALE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface FileGuardStoreOptions {
  readonly lockTimeoutMs?: number;
}

export class FileGuardStore implements GuardStore {
  readonly #lockPath: string;
  readonly #lockTimeoutMs: number;

  constructor(
    readonly path: string,
    options: FileGuardStoreOptions = {},
  ) {
    this.#lockPath = `${path}.lock`;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
  }

  async transaction<T>(
    run: (state: GuardState, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const release = await this.#lock();
    try {
      const state = await this.#read();
      return await run(state, () => this.#write(state));
    } finally {
      await release();
    }
  }

  async #lock(): Promise<() => Promise<void>> {
    const token = `${hostname()}:${process.pid}:${randomUUID()}`;
    const deadline = Date.now() + this.#lockTimeoutMs;
    for (;;) {
      try {
        await writeFile(this.#lockPath, token, { flag: "wx" });
        return async () => {
          const holder = await readFile(this.#lockPath, "utf8").catch(() => "");
          if (holder === token) await unlink(this.#lockPath).catch(() => {});
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (await this.#breakAbandonedLock()) continue;
      if (Date.now() > deadline) {
        throw new EcomError(
          "busy",
          `Another checkout holds ${this.#lockPath}; try again shortly`,
        );
      }
      await sleep(LOCK_POLL_MS);
    }
  }

  async #breakAbandonedLock(): Promise<boolean> {
    let holder: string;
    let ageMs: number;
    try {
      holder = await readFile(this.#lockPath, "utf8");
      ageMs = Date.now() - (await stat(this.#lockPath)).mtimeMs;
    } catch {
      return true;
    }
    if (!abandoned(holder, ageMs)) return false;

    const moved = `${this.#lockPath}.${randomUUID()}`;
    try {
      await rename(this.#lockPath, moved);
    } catch {
      return true;
    }
    const movedHolder = await readFile(moved, "utf8").catch(() => holder);
    if (movedHolder !== holder) {
      await link(moved, this.#lockPath).catch(() => {});
    }
    await unlink(moved).catch(() => {});
    return true;
  }

  async #read(): Promise<GuardState> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { confirmations: [], spend: [] };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed["confirmations"] ?? []) ||
      !Array.isArray(parsed["spend"] ?? [])
    ) {
      throw new EcomError(
        "invalid_input",
        `${this.path} is corrupt; inspect it, or delete it to reset the spending history`,
      );
    }
    return {
      confirmations: (parsed["confirmations"] ?? []) as Confirmation[],
      spend: (parsed["spend"] ?? []) as SpendRecord[],
    };
  }

  async #write(state: GuardState): Promise<void> {
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state), "utf8");
    await rename(temp, this.path);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function previewDigest(preview: CheckoutPreview): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(preview)))
    .digest("hex");
}

export type CheckoutResult =
  | {
      readonly status: "needs_confirmation";
      readonly preview: CheckoutPreview;
      readonly confirmationCode: string;
      readonly expiresAt: string;
      readonly spentToday: Money;
      readonly limits: SpendingLimits;
    }
  | {
      readonly status: "placed";
      readonly order: Order;
      readonly warnings: readonly string[];
    };

function definitelyRejected(error: unknown): boolean {
  if (!(error instanceof EcomError)) return false;
  if (error.code !== "http") return true;
  const status = isRecord(error.details) ? error.details["status"] : undefined;
  return typeof status === "number" && status >= 400 && status < 500;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const SPEND_RETENTION_MS = 31 * DAY_MS;

export interface CheckoutGuardOptions {
  readonly limits: SpendingLimits;
  readonly store: GuardStore;
  readonly now?: () => Date;
}

export class CheckoutGuard {
  readonly #limits: SpendingLimits;
  readonly #store: GuardStore;
  readonly #now: () => Date;

  constructor(options: CheckoutGuardOptions) {
    this.#limits = options.limits;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  async checkout(
    provider: Provider,
    ctx: ProviderContext,
    confirm?: string,
  ): Promise<CheckoutResult> {
    const { checkoutPreview, placeOrder } = provider;
    if (!checkoutPreview || !placeOrder) {
      throw new EcomError(
        "unsupported",
        `${provider.id} does not support checkout`,
      );
    }
    const preview = await checkoutPreview.call(provider, ctx);
    if (preview.items.length === 0) {
      throw new EcomError("invalid_input", "The cart is empty");
    }
    const digest = previewDigest(preview);

    return this.#store.transaction(async (state, save) => {
      const now = this.#now();
      this.#prune(state, now);

      if (confirm === undefined) {
        const spentToday = this.#checkLimits(state, preview.total, now);
        const code = randomBytes(4).toString("hex");
        state.confirmations = state.confirmations.filter(
          (entry) => entry.provider !== provider.id,
        );
        state.confirmations.push({
          code,
          provider: provider.id,
          digest,
          issuedAt: now.toISOString(),
        });
        await save();
        return {
          status: "needs_confirmation",
          preview,
          confirmationCode: code,
          expiresAt: new Date(
            now.getTime() + CONFIRMATION_TTL_MS,
          ).toISOString(),
          spentToday,
          limits: this.#limits,
        };
      }

      const confirmation = state.confirmations.find(
        (entry) => entry.code === confirm && entry.provider === provider.id,
      );
      if (confirmation === undefined) {
        throw new EcomError(
          "confirmation_required",
          "Unknown, used or expired confirmation code; run checkout without a code to get a new preview",
        );
      }
      state.confirmations = state.confirmations.filter(
        (entry) => entry.provider !== provider.id,
      );
      if (confirmation.digest !== digest) {
        await save();
        throw new EcomError(
          "confirmation_required",
          "The order changed since this code was issued; run checkout without a code to review it again",
        );
      }
      this.#checkLimits(state, preview.total, now);

      const record: SpendRecord = {
        id: randomUUID(),
        provider: provider.id,
        at: now.toISOString(),
        status: "pending",
        total: preview.total,
      };
      state.spend.push(record);
      await save();

      let order: Order;
      try {
        order = await placeOrder.call(provider, preview, ctx);
      } catch (error) {
        if (definitelyRejected(error)) {
          state.spend = state.spend.filter((entry) => entry !== record);
        } else {
          record.status = "failed";
        }
        await save().catch(() => {});
        throw error;
      }

      const warnings: string[] = [];
      record.status = "placed";
      record.orderId = order.id;
      if (
        order.total.amount !== preview.total.amount ||
        order.total.currency !== preview.total.currency
      ) {
        warnings.push(
          `The order total ${formatMoney(order.total)} differs from the confirmed ${formatMoney(preview.total)}`,
        );
        if (order.total.currency === record.total.currency) {
          record.total = order.total;
        }
      }
      try {
        await save();
      } catch (error) {
        warnings.push(
          `The order was placed but recording it failed: ${String(error)}`,
        );
      }
      return { status: "placed", order, warnings };
    });
  }

  #prune(state: GuardState, now: Date): void {
    const time = now.getTime();
    state.confirmations = state.confirmations.filter(
      (entry) => time - Date.parse(entry.issuedAt) < CONFIRMATION_TTL_MS,
    );
    state.spend = state.spend.filter(
      (record) => !(time - Date.parse(record.at) > SPEND_RETENTION_MS),
    );
  }

  #checkLimits(state: GuardState, total: Money, now: Date): Money {
    const { perOrder, perDay } = this.#limits;
    if (
      total.currency !== perOrder.currency ||
      total.currency !== perDay.currency
    ) {
      throw new EcomError(
        "limit_exceeded",
        `No spending limit is configured for ${total.currency}`,
      );
    }
    if (total.amount > perOrder.amount) {
      throw new EcomError(
        "limit_exceeded",
        `Order total ${formatMoney(total)} exceeds the per-order limit of ${formatMoney(perOrder)}`,
      );
    }
    const since = now.getTime() - DAY_MS;
    let spent = 0;
    for (const record of state.spend) {
      if (!(Date.parse(record.at) <= since)) spent += record.total.amount;
    }
    if (spent + total.amount > perDay.amount) {
      throw new EcomError(
        "limit_exceeded",
        `Order total ${formatMoney(total)} plus ${formatMoney(money(spent, total.currency))} spent in the last 24 hours exceeds the daily limit of ${formatMoney(perDay)}`,
      );
    }
    return money(spent, total.currency);
  }
}
