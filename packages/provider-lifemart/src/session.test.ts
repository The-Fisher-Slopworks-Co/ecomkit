import { describe, expect, test } from "bun:test";
import {
  createHttpClient,
  providerSecrets,
  type ProviderContext,
  type SecretStore,
} from "@ecomkit/core";
import { Session, apiKey, normalizePhone } from "./session.ts";

interface Call {
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

type Reply = readonly [status: number, body: unknown];

const DEVICE_ID = "5c0e9a7b31d24f68jm";
const SERVER_KEY = "qWeRtYuIoPaSdFgHjKlZxCvBnM";

function setup(
  replies: Record<string, Reply[]>,
  stored: Record<string, string> = {},
) {
  const values = new Map(Object.entries(stored));
  const store: SecretStore = {
    backend: "memory",
    get: async (_provider, key) => values.get(key),
    set: async (_provider, key, value) => {
      values.set(key, value);
    },
    delete: async (_provider, key) => values.delete(key),
  };
  const calls: Call[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace(/^\/api\//, "");
    calls.push({
      path,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const [status, body] = replies[path]?.shift() ?? [200, { success: true }];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "x-api-key": SERVER_KEY },
    });
  };
  const ctx: ProviderContext = {
    secrets: providerSecrets(store, "lifemart"),
    http: (baseUrl) => createHttpClient({ baseUrl, fetch }),
  };
  return { ctx, calls, values };
}

const issued = {
  success: true,
  token: "refresh-1",
  access_token: "access-1",
  access_token_expire: "2026-01-01T13:00:00+05:00",
};

const wrongCode = { success: false, error_message: "Неверный код" };

function answering(...answers: string[]) {
  const asked: [string, boolean | undefined][] = [];
  const ask = async (label: string, options?: { visible?: boolean }) => {
    asked.push([label, options?.visible]);
    return answers.shift() ?? "";
  };
  return { ask, asked };
}

describe("lifemart session", () => {
  test("signs in with an SMS code and keeps the tokens", async () => {
    const { ctx, calls, values } = setup({
      "user/registerCheck": [[200, issued]],
    });
    const { ask, asked } = answering("+7 (999) 000-00-00", "1234");

    await new Session(DEVICE_ID).signIn(ask, ctx);

    expect(asked).toEqual([
      ["Phone number", true],
      ["Code from SMS sent to +79990000000", true],
    ]);
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      ["user/getAvailableRegisterTypes", undefined],
      [
        "user/register",
        { phone: "9990000000", verify_type: "sms", bonus_register: false },
      ],
      ["user/registerCheck", { phone: "9990000000", code: "1234" }],
    ]);
    expect(Object.fromEntries(values)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessTokenExpire: "2026-01-01T13:00:00+05:00",
    });
  });

  test("sends the API key learned from the previous response", async () => {
    const { ctx, calls } = setup({ "user/registerCheck": [[200, issued]] });

    await new Session(DEVICE_ID).signIn(
      answering("9990000000", "1234").ask,
      ctx,
    );

    expect(calls.map((call) => call.headers.get("x-api-key"))).toEqual([
      null,
      "11227260",
      "11227260",
    ]);
    expect(calls.every((call) => call.headers.get("uuid") === DEVICE_ID)).toBe(
      true,
    );
  });

  test("keeps a generated device id for later requests", async () => {
    const { ctx, calls, values } = setup({
      "user/registerCheck": [[200, issued]],
    });

    await new Session().signIn(answering("9990000000", "1234").ask, ctx);

    const device = values.get("device");
    expect(device).toMatch(/^[\da-f]{16}jm$/);
    expect(calls.every((call) => call.headers.get("uuid") === device)).toBe(
      true,
    );
  });

  test("asks again after a wrong code and shows why", async () => {
    const { ctx, values } = setup({
      "user/registerCheck": [
        [200, wrongCode],
        [200, issued],
      ],
    });
    const { ask, asked } = answering("9990000000", "0000", "1234");

    await new Session(DEVICE_ID).signIn(ask, ctx);

    expect(asked.at(-1)).toEqual([
      "Lifemart rejected the code (Неверный код), enter it again",
      true,
    ]);
    expect(values.get("accessToken")).toBe("access-1");
  });

  test("keeps the pending sign-in after the last wrong code", async () => {
    const { ctx, values } = setup({
      "user/registerCheck": [
        [200, wrongCode],
        [200, wrongCode],
        [200, wrongCode],
      ],
    });
    const { ask } = answering("9990000000", "1", "2", "3");

    await expect(new Session(DEVICE_ID).signIn(ask, ctx)).rejects.toThrow(
      "ecom login lifemart --code",
    );
    expect(values.get("signIn")).toBe(JSON.stringify({ phone: "9990000000" }));
  });

  test("finishes a pending sign-in without a new SMS", async () => {
    const { ctx, calls, values } = setup(
      { "user/registerCheck": [[200, issued]] },
      { signIn: JSON.stringify({ phone: "9990000000" }) },
    );
    const { ask, asked } = answering("1234");

    await new Session(DEVICE_ID).signIn(ask, ctx, { codeSent: true });

    expect(asked).toEqual([["Code from SMS sent to +79990000000", true]]);
    expect(calls.map((call) => call.path)).toEqual(["user/registerCheck"]);
    expect(values.has("signIn")).toBe(false);
  });

  test("takes a code requested on the site by asking for the phone", async () => {
    const { ctx, calls } = setup({ "user/registerCheck": [[200, issued]] });
    const { ask, asked } = answering("9990000000", "1234");

    await new Session(DEVICE_ID).signIn(ask, ctx, { codeSent: true });

    expect(asked.map(([label]) => label)).toEqual([
      "Phone number",
      "Code from SMS sent to +79990000000",
    ]);
    expect(calls.map((call) => call.path)).toEqual(["user/registerCheck"]);
  });

  test("points to the site when a captcha is required", async () => {
    const { ctx, values } = setup({
      "user/register": [
        [
          200,
          {
            success: false,
            error_code: "captcha_required",
            error_message: "Подтвердите, что вы не робот",
          },
        ],
      ],
    });

    await expect(
      new Session(DEVICE_ID).signIn(answering("9990000000").ask, ctx),
    ).rejects.toThrow("lifemart.ru");
    expect(values.has("signIn")).toBe(true);
  });

  test("passes on a refusal to send the code", async () => {
    const { ctx } = setup({
      "user/register": [
        [
          200,
          {
            success: false,
            error_code: "too_often",
            error_message: "Слишком часто",
            retry_seconds: 42,
          },
        ],
      ],
    });

    await expect(
      new Session(DEVICE_ID).signIn(answering("9990000000").ask, ctx),
    ).rejects.toThrow("Слишком часто; try again in 42 s");
  });
});

const NOW = Date.parse("2026-01-01T12:00:00+05:00");

const tokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  accessTokenExpire: "2026-01-01T13:00:00+05:00",
};

const refreshed = { ...issued, token: "refresh-2", access_token: "access-2" };

describe("lifemart authorized requests", () => {
  test("send the raw access token", async () => {
    const { ctx, calls } = setup({}, tokens);

    await new Session(DEVICE_ID, () => NOW).authorized(ctx, "GET", "cart");

    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      "access-1",
    ]);
  });

  test("refresh a token that is about to expire first", async () => {
    const { ctx, calls, values } = setup(
      { "user/refreshToken": [[200, refreshed]] },
      { ...tokens, accessTokenExpire: "2026-01-01T12:00:30+05:00" },
    );

    await new Session(DEVICE_ID, () => NOW).authorized(ctx, "GET", "cart");

    expect(calls.map((call) => [call.path, call.body])).toEqual([
      ["user/refreshToken", { refresh_token: "refresh-1" }],
      ["cart", undefined],
    ]);
    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[1]?.headers.get("authorization")).toBe("access-2");
    expect(values.get("refreshToken")).toBe("refresh-2");
  });

  test("refresh once after a 401", async () => {
    const { ctx, calls } = setup(
      {
        cart: [[401, { error_code: "access_token_expired" }]],
        "user/refreshToken": [[200, refreshed]],
      },
      tokens,
    );

    await new Session(DEVICE_ID, () => NOW).authorized(ctx, "GET", "cart");

    expect(
      calls.map((call) => [call.path, call.headers.get("authorization")]),
    ).toEqual([
      ["cart", "access-1"],
      ["user/refreshToken", null],
      ["cart", "access-2"],
    ]);
  });

  test("ask to sign in again when the refresh token is rejected", async () => {
    const { ctx } = setup(
      {
        cart: [[401, { error_code: "access_token_expired" }]],
        "user/refreshToken": [[401, { error_code: "invalid_refresh_token" }]],
      },
      tokens,
    );

    await expect(
      new Session(DEVICE_ID, () => NOW).authorized(ctx, "GET", "cart"),
    ).rejects.toThrow("ecom login lifemart");
  });

  test("ask to sign in without a token", async () => {
    const { ctx, calls } = setup({});

    await expect(
      new Session(DEVICE_ID).authorized(ctx, "GET", "cart"),
    ).rejects.toThrow(expect.objectContaining({ code: "auth_required" }));
    expect(calls).toEqual([]);
  });
});

describe("apiKey", () => {
  test("mixes the device id with the server key like the app", () => {
    expect(apiKey(DEVICE_ID, SERVER_KEY)).toBe("11227260");
  });
});

describe("normalizePhone", () => {
  test("keeps ten national digits", () => {
    expect(normalizePhone("+7 999 000-00-00")).toBe("9990000000");
    expect(normalizePhone("89990000000")).toBe("9990000000");
    expect(normalizePhone("9990000000")).toBe("9990000000");
  });

  test("rejects other numbers", () => {
    expect(() => normalizePhone("+7 495 000-00-00")).toThrow("Russian mobile");
  });
});
