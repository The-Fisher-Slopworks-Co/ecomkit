import { randomBytes } from "node:crypto";
import {
  EcomError,
  type Ask,
  type HttpRequest,
  type LoginOptions,
  type ProviderContext,
} from "@ecomkit/core";

const API_URL = "https://api.lifemart.ru/api/";
const APP_VERSION = "1.68.0";
const API_KEY_SALT = "Lhkji_asQ4";
const API_KEY_MODULUS = 16_771_234;

const DEVICE = "device";
const ACCESS_TOKEN = "accessToken";
const ACCESS_TOKEN_EXPIRE = "accessTokenExpire";
const REFRESH_TOKEN = "refreshToken";
const SIGN_IN = "signIn";
const CODE_ATTEMPTS = 3;

export const sessionSecrets = [
  { key: DEVICE, label: "Device id the Lifemart session is bound to" },
  { key: ACCESS_TOKEN, label: "Lifemart access token" },
  { key: ACCESS_TOKEN_EXPIRE, label: "When the Lifemart access token expires" },
  { key: REFRESH_TOKEN, label: "Lifemart refresh token" },
  { key: SIGN_IN, label: "SMS sign-in waiting for its code" },
] as const;

interface Reply {
  readonly success: boolean;
  readonly error_code?: string | null;
  readonly error_message?: string | null;
}

interface SendCodeReply extends Reply {
  readonly retry_seconds?: number | null;
}

interface TokensReply extends Reply {
  readonly token?: string | null;
  readonly access_token?: string | null;
  readonly access_token_expire?: string | null;
}

type Headers = Readonly<Record<string, string>>;

export class Session {
  readonly #fallbackDevice = newDeviceId();
  #apiKey: string | undefined;

  constructor(private readonly deviceId?: string) {}

  async request<T>(
    ctx: ProviderContext,
    method: string,
    path: string,
    init: HttpRequest = {},
  ): Promise<T> {
    const headers = await this.headers(ctx);
    return ctx.http(API_URL).request<T>(method, path, {
      ...init,
      headers: { ...headers, ...init.headers },
      onResponse: (response) => {
        const server = response.get("x-api-key");
        if (server) this.#apiKey = apiKey(headers.uuid ?? "", server);
      },
    });
  }

  private async headers(ctx: ProviderContext): Promise<Headers> {
    const device =
      this.deviceId ?? (await ctx.secrets.get(DEVICE)) ?? this.#fallbackDevice;
    return {
      uuid: device,
      "mindbox-uuid": "",
      "app-version": APP_VERSION,
      "x-platform": "Android",
      "content-language": "ru",
      "user-agent": "okhttp/4.12.0",
      ...(this.#apiKey === undefined ? {} : { "x-api-key": this.#apiKey }),
    };
  }

  async signIn(
    ask: Ask,
    ctx: ProviderContext,
    { codeSent = false }: LoginOptions = {},
  ): Promise<void> {
    if (this.deviceId === undefined && !(await ctx.secrets.get(DEVICE))) {
      await ctx.secrets.set(DEVICE, this.#fallbackDevice);
    }
    const phone = codeSent
      ? await pendingPhone(ask, ctx)
      : await this.sendCode(ask, ctx);
    const reply = await this.checkCode(ask, ctx, phone);
    await ctx.secrets.set(ACCESS_TOKEN, reply.access_token);
    await ctx.secrets.set(REFRESH_TOKEN, reply.token);
    if (reply.access_token_expire) {
      await ctx.secrets.set(ACCESS_TOKEN_EXPIRE, reply.access_token_expire);
    }
    await ctx.secrets.delete(SIGN_IN);
  }

  private async sendCode(ask: Ask, ctx: ProviderContext): Promise<string> {
    const phone = await askPhone(ask);
    await ctx.secrets.set(SIGN_IN, JSON.stringify({ phone }));
    await this.request(ctx, "GET", "user/getAvailableRegisterTypes");
    const reply = await this.request<SendCodeReply>(
      ctx,
      "POST",
      "user/register",
      { body: { phone, verify_type: "sms", bonus_register: false } },
    );
    if (!reply.success) throw sendCodeRefused(reply);
    return phone;
  }

  private async checkCode(ask: Ask, ctx: ProviderContext, phone: string) {
    let label = `Code from SMS sent to +7${phone}`;
    for (let attempt = 1; ; attempt++) {
      const code = await ask(label, { visible: true });
      const reply = await this.request<TokensReply>(
        ctx,
        "POST",
        "user/registerCheck",
        { body: { phone, code } },
      );
      const { success, token, access_token } = reply;
      if (success && token && access_token) {
        return { ...reply, token, access_token };
      }
      const reason = reply.error_message || "the code was not accepted";
      if (attempt === CODE_ATTEMPTS) {
        throw new EcomError(
          "invalid_input",
          `Lifemart rejected the code: ${reason}; run \`ecom login lifemart --code\` to try again`,
        );
      }
      label = `Lifemart rejected the code (${reason}), enter it again`;
    }
  }
}

export function apiKey(device: string, server: string): string {
  return String(
    Math.imul(apiKeyHash(device), apiKeyHash(server)) % API_KEY_MODULUS,
  );
}

function apiKeyHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < Math.max(text.length, API_KEY_SALT.length); i++) {
    hash ^= Math.imul(
      API_KEY_SALT.charCodeAt(i % API_KEY_SALT.length),
      text.charCodeAt(i % text.length),
    );
  }
  return hash;
}

async function askPhone(ask: Ask): Promise<string> {
  return normalizePhone(await ask("Phone number", { visible: true }));
}

async function pendingPhone(ask: Ask, ctx: ProviderContext): Promise<string> {
  const stored = await ctx.secrets.get(SIGN_IN);
  return stored === undefined
    ? askPhone(ask)
    : (JSON.parse(stored) as { phone: string }).phone;
}

function sendCodeRefused(reply: SendCodeReply): EcomError {
  const reason = reply.error_message || reply.error_code || "unknown error";
  if (reply.error_code === "captcha_required") {
    return new EcomError(
      "auth_required",
      `Lifemart asks for a captcha before sending the code (${reason}); request the code on lifemart.ru and finish with \`ecom login lifemart --code\``,
    );
  }
  const wait = reply.retry_seconds ? ` in ${reply.retry_seconds} s` : "";
  return new EcomError(
    "invalid_input",
    `Lifemart did not send the code: ${reason}; try again${wait}`,
  );
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits;
  if (!/^9\d{9}$/.test(national)) {
    throw new EcomError(
      "invalid_input",
      "Expected a Russian mobile number such as +7 999 123-45-67",
    );
  }
  return national;
}

function newDeviceId(): string {
  return `${randomBytes(8).toString("hex")}jm`;
}
