import { randomUUID } from "node:crypto";
import { EcomError, type Ask, type ProviderContext } from "@ecomkit/core";

const ID_URL = "https://id.magnit.ru/";
const AUDIENCE = "loyalty-mobile";
const APP_VERSION = "8.124.0";
const USER_AGENT =
  "Dalvik/2.1.0 (Linux; U; Android 14; SM-S918B Build/UP1A.231005.007)";

const DEVICE = "device";
const ACCESS_TOKEN = "accessToken";
const REFRESH_TOKEN = "refreshToken";

export const sessionSecrets = [
  { key: DEVICE, label: "Device id the Magnit session is bound to" },
  { key: ACCESS_TOKEN, label: "Magnit ID access token" },
  { key: REFRESH_TOKEN, label: "Magnit ID refresh token" },
] as const;

interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

type Headers = Readonly<Record<string, string>>;

export class Session {
  readonly #fallbackDevice = randomUUID();

  constructor(private readonly deviceId?: string) {}

  async headers(ctx: ProviderContext): Promise<Headers> {
    const device =
      this.deviceId ?? (await ctx.secrets.get(DEVICE)) ?? this.#fallbackDevice;
    return {
      "user-agent": USER_AGENT,
      "x-app-version": APP_VERSION,
      "x-device-id": device,
      "x-device-platform": "Android",
      "x-platform-version": "36",
    };
  }

  async signIn(ask: Ask, ctx: ProviderContext): Promise<void> {
    if (this.deviceId === undefined && !(await ctx.secrets.get(DEVICE))) {
      await ctx.secrets.set(DEVICE, this.#fallbackDevice);
    }
    const phone = normalizePhone(await ask("Phone number"));
    const headers = await this.headers(ctx);
    const id = ctx.http(ID_URL);
    const { attemptId } = await id.post<{ attemptId: string }>("v1/auth/otp", {
      headers: { ...headers, "x-device-tag": randomUUID() },
      body: {
        aud: AUDIENCE,
        phone,
        "captcha-token": "captcha-token",
        forceSMS: true,
      },
    });
    const code = await ask("Code from SMS");
    const { magnitIDCode } = await id.post<{ magnitIDCode: string }>(
      "v1/auth/otp/check",
      { headers, body: { attemptId, aud: AUDIENCE, code, phone } },
    );
    await saveTokens(
      ctx,
      await id.post<Tokens>("v1/auth/token", {
        headers,
        body: { aud: AUDIENCE, magnitIdCode: magnitIDCode },
      }),
    );
  }

  async authorized<T>(
    ctx: ProviderContext,
    send: (headers: Headers) => Promise<T>,
  ): Promise<T> {
    const headers = await this.headers(ctx);
    const token = await ctx.secrets.get(ACCESS_TOKEN);
    if (token === undefined) throw signInRequired();
    try {
      return await send({ ...headers, authorization: `bearer ${token}` });
    } catch (error) {
      if (!(error instanceof EcomError && error.code === "auth_required")) {
        throw error;
      }
    }
    const fresh = await this.refresh(ctx, headers);
    return send({ ...headers, authorization: `bearer ${fresh}` });
  }

  private async refresh(
    ctx: ProviderContext,
    headers: Headers,
  ): Promise<string> {
    const refreshToken = await ctx.secrets.get(REFRESH_TOKEN);
    if (refreshToken === undefined) throw signInRequired();
    let tokens: Tokens;
    try {
      tokens = await ctx.http(ID_URL).post<Tokens>("v1/auth/token/refresh", {
        headers,
        body: { aud: AUDIENCE, refreshToken },
      });
    } catch (error) {
      if (error instanceof EcomError && isRejected(error)) {
        throw signInRequired();
      }
      throw error;
    }
    await saveTokens(ctx, tokens);
    return tokens.accessToken;
  }
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
  return `7${national}`;
}

async function saveTokens(ctx: ProviderContext, tokens: Tokens) {
  await ctx.secrets.set(ACCESS_TOKEN, tokens.accessToken);
  await ctx.secrets.set(REFRESH_TOKEN, tokens.refreshToken);
}

function isRejected(error: EcomError): boolean {
  const status = (error.details as { status?: number } | undefined)?.status;
  return status !== undefined && status >= 400 && status < 500;
}

function signInRequired(): EcomError {
  return new EcomError(
    "auth_required",
    "Magnit session is missing or expired; run `ecom login magnit`",
  );
}
