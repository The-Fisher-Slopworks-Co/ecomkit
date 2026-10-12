import { randomUUID } from "node:crypto";
import {
  EcomError,
  type Ask,
  type LoginOptions,
  type ProviderContext,
} from "@ecomkit/core";

const ID_URL = "https://id.magnit.ru/";
const AUDIENCE = "loyalty-mobile";
const APP_VERSION = "8.124.0";
const USER_AGENT =
  "Dalvik/2.1.0 (Linux; U; Android 14; SM-S918B Build/UP1A.231005.007)";

const DEVICE = "device";
const ACCESS_TOKEN = "accessToken";
const REFRESH_TOKEN = "refreshToken";
const SIGN_IN = "signIn";
const CODE_ATTEMPTS = 3;

export const sessionSecrets = [
  { key: DEVICE, label: "Device id the Magnit session is bound to" },
  { key: ACCESS_TOKEN, label: "Magnit ID access token" },
  { key: REFRESH_TOKEN, label: "Magnit ID refresh token" },
  { key: SIGN_IN, label: "SMS sign-in waiting for its code" },
] as const;

interface PendingSignIn {
  readonly attemptId: string;
  readonly phone: string;
  readonly deviceTag: string;
}

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

  async signIn(
    ask: Ask,
    ctx: ProviderContext,
    { codeSent = false }: LoginOptions = {},
  ): Promise<void> {
    if (this.deviceId === undefined && !(await ctx.secrets.get(DEVICE))) {
      await ctx.secrets.set(DEVICE, this.#fallbackDevice);
    }
    const pending = codeSent
      ? await pendingSignIn(ctx)
      : await this.sendCode(ask, ctx);
    const headers = {
      ...(await this.headers(ctx)),
      "x-device-tag": pending.deviceTag,
    };
    const magnitIdCode = await checkCode(ask, ctx, headers, pending);
    await saveTokens(
      ctx,
      await ctx.http(ID_URL).post<Tokens>("v1/auth/token", {
        headers,
        body: { aud: AUDIENCE, magnitIdCode },
      }),
    );
    await ctx.secrets.delete(SIGN_IN);
  }

  private async sendCode(
    ask: Ask,
    ctx: ProviderContext,
  ): Promise<PendingSignIn> {
    const phone = normalizePhone(await ask("Phone number", { visible: true }));
    const deviceTag = randomUUID();
    const { attemptId } = await ctx
      .http(ID_URL)
      .post<{ attemptId: string }>("v1/auth/otp", {
        headers: { ...(await this.headers(ctx)), "x-device-tag": deviceTag },
        body: {
          aud: AUDIENCE,
          phone,
          "captcha-token": "captcha-token",
          forceSMS: true,
        },
      });
    const pending = { attemptId, phone, deviceTag };
    await ctx.secrets.set(SIGN_IN, JSON.stringify(pending));
    return pending;
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

async function pendingSignIn(ctx: ProviderContext): Promise<PendingSignIn> {
  const stored = await ctx.secrets.get(SIGN_IN);
  if (stored === undefined) {
    throw new EcomError(
      "invalid_input",
      "No code was sent; run `ecom login magnit` without --code",
    );
  }
  return JSON.parse(stored) as PendingSignIn;
}

async function checkCode(
  ask: Ask,
  ctx: ProviderContext,
  headers: Headers,
  { attemptId, phone }: PendingSignIn,
): Promise<string> {
  let label = `Code from SMS sent to +${phone}`;
  for (let attempt = 1; ; attempt++) {
    const code = await ask(label, { visible: true });
    try {
      const { magnitIDCode } = await ctx
        .http(ID_URL)
        .post<{ magnitIDCode: string }>("v1/auth/otp/check", {
          headers,
          body: { attemptId, aud: AUDIENCE, code, phone },
        });
      return magnitIDCode;
    } catch (error) {
      if (!(error instanceof EcomError && isRejected(error))) throw error;
      const reason = rejectionMessage(error);
      if (attempt === CODE_ATTEMPTS) {
        throw new EcomError(
          "invalid_input",
          `Magnit rejected the code: ${reason}; run \`ecom login magnit --code\` to try again`,
        );
      }
      label = `Magnit rejected the code (${reason}), enter it again`;
    }
  }
}

function rejectionMessage(error: EcomError): string {
  const body = (error.details as { body?: unknown } | undefined)?.body;
  const message =
    typeof body === "object" && body !== null && "message" in body
      ? body.message
      : undefined;
  return typeof message === "string" && message !== ""
    ? message
    : error.message;
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
