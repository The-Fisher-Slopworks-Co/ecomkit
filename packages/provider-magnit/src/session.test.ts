import { describe, expect, test } from "bun:test";
import {
  EcomError,
  createHttpClient,
  providerSecrets,
  type ProviderContext,
  type SecretStore,
} from "@ecomkit/core";
import { Session, normalizePhone } from "./session.ts";

interface Call {
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

type Reply = readonly [status: number, body: unknown];

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
    const url = new URL(input);
    const path = `${url.host}${url.pathname}`;
    calls.push({
      path,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const [status, body] = replies[path]?.shift() ?? [404, {}];
    return new Response(JSON.stringify(body), { status });
  };
  const ctx: ProviderContext = {
    secrets: providerSecrets(store, "magnit"),
    http: (baseUrl) => createHttpClient({ baseUrl, fetch }),
  };
  return { ctx, calls, values };
}

const tokens = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
});

describe("magnit session", () => {
  test("signs in with an SMS code and keeps the tokens", async () => {
    const { ctx, calls, values } = setup({
      "id.magnit.ru/v1/auth/otp": [[200, { attemptId: "attempt-1" }]],
      "id.magnit.ru/v1/auth/otp/check": [[200, { magnitIDCode: "mid-1" }]],
      "id.magnit.ru/v1/auth/token": [[200, tokens(1)]],
    });
    const asked: [string, boolean | undefined][] = [];
    const answers = ["+7 (999) 000-00-00", "12345"];

    await new Session().signIn(async (label, options) => {
      asked.push([label, options?.visible]);
      return answers.shift() ?? "";
    }, ctx);

    expect(asked).toEqual([
      ["Phone number", true],
      ["Code from SMS sent to +79990000000", true],
    ]);
    expect(calls.map((call) => call.body)).toEqual([
      {
        aud: "loyalty-mobile",
        phone: "79990000000",
        "captcha-token": "captcha-token",
        forceSMS: true,
      },
      {
        attemptId: "attempt-1",
        aud: "loyalty-mobile",
        code: "12345",
        phone: "79990000000",
      },
      { aud: "loyalty-mobile", magnitIdCode: "mid-1" },
    ]);
    const tags = new Set(calls.map((call) => call.headers.get("x-device-tag")));
    expect([...tags]).toHaveLength(1);
    expect([...tags][0]).toBeTruthy();
    expect(values.has("signIn")).toBe(false);
    expect(calls[0]?.headers.get("x-device-id")).toBe(
      values.get("device") ?? "",
    );
    expect(values.get("accessToken")).toBe("access-1");
    expect(values.get("refreshToken")).toBe("refresh-1");
  });

  test("keeps the stored device id across sign-ins", async () => {
    const { ctx, calls } = setup(
      {
        "id.magnit.ru/v1/auth/otp": [[200, { attemptId: "a" }]],
        "id.magnit.ru/v1/auth/otp/check": [[200, { magnitIDCode: "m" }]],
        "id.magnit.ru/v1/auth/token": [[200, tokens(1)]],
      },
      { device: "device-1" },
    );

    await new Session().signIn(async () => "9990000000", ctx);

    expect(calls.map((call) => call.headers.get("x-device-id"))).toEqual([
      "device-1",
      "device-1",
      "device-1",
    ]);
  });

  test("asks for the code again when Magnit rejects it", async () => {
    const wrong: Reply = [400, { message: "Неверный код" }];
    const { ctx, calls, values } = setup({
      "id.magnit.ru/v1/auth/otp": [[200, { attemptId: "a" }]],
      "id.magnit.ru/v1/auth/otp/check": [wrong, [200, { magnitIDCode: "m" }]],
      "id.magnit.ru/v1/auth/token": [[200, tokens(1)]],
    });
    const asked: string[] = [];
    const answers = ["9990000000", "11111", "22222"];

    await new Session().signIn(async (label) => {
      asked.push(label);
      return answers.shift() ?? "";
    }, ctx);

    expect(asked.at(-1)).toBe(
      "Magnit rejected the code (Неверный код), enter it again",
    );
    expect(calls.filter((call) => call.path.endsWith("/otp"))).toHaveLength(1);
    expect(values.get("accessToken")).toBe("access-1");
  });

  test("keeps the sent code for --code after three wrong tries", async () => {
    const wrong: Reply = [400, { message: "Неверный код" }];
    const { ctx, values } = setup({
      "id.magnit.ru/v1/auth/otp": [[200, { attemptId: "a" }]],
      "id.magnit.ru/v1/auth/otp/check": [wrong, wrong, wrong],
    });

    await expect(
      new Session().signIn(async () => "9990000000", ctx),
    ).rejects.toThrow("ecom login magnit --code");
    expect(JSON.parse(values.get("signIn") ?? "{}")).toMatchObject({
      attemptId: "a",
      phone: "79990000000",
    });
  });

  test("enters a code that was already sent without sending another", async () => {
    const pending = { attemptId: "a", phone: "79990000000", deviceTag: "tag" };
    const { ctx, calls, values } = setup(
      {
        "id.magnit.ru/v1/auth/otp/check": [[200, { magnitIDCode: "m" }]],
        "id.magnit.ru/v1/auth/token": [[200, tokens(1)]],
      },
      { device: "device-1", signIn: JSON.stringify(pending) },
    );

    await new Session().signIn(async () => "12345", ctx, { codeSent: true });

    expect(calls.map((call) => call.path)).toEqual([
      "id.magnit.ru/v1/auth/otp/check",
      "id.magnit.ru/v1/auth/token",
    ]);
    expect(calls[0]?.headers.get("x-device-tag")).toBe("tag");
    expect(calls[0]?.body).toMatchObject({ attemptId: "a", code: "12345" });
    expect(values.has("signIn")).toBe(false);
  });

  test("asks to send a code when none is waiting", async () => {
    const { ctx } = setup({});

    await expect(
      new Session().signIn(async () => "12345", ctx, { codeSent: true }),
    ).rejects.toThrow("without --code");
  });

  test.each(["123", "+7 495 000-00-00", "8 999 000 00 0"])(
    "rejects the phone number %p",
    (raw) => {
      expect(() => normalizePhone(raw)).toThrow(EcomError);
    },
  );

  test("refreshes an expired access token once and retries", async () => {
    const { ctx, calls, values } = setup(
      {
        "id.magnit.ru/v1/auth/token/refresh": [[200, tokens(2)]],
      },
      { device: "device-1", ...tokens(1) },
    );
    const seen: (string | null)[] = [];

    const result = await new Session().authorized(ctx, async (headers) => {
      seen.push(headers["authorization"] ?? null);
      if (seen.length === 1) {
        throw new EcomError("auth_required", "expired", { status: 401 });
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(seen).toEqual(["bearer access-1", "bearer access-2"]);
    expect(calls[0]?.body).toEqual({
      aud: "loyalty-mobile",
      refreshToken: "refresh-1",
    });
    expect(values.get("refreshToken")).toBe("refresh-2");
  });

  test("asks to sign in again when the refresh token is rejected", async () => {
    const { ctx } = setup(
      { "id.magnit.ru/v1/auth/token/refresh": [[401, {}]] },
      tokens(1),
    );

    await expect(
      new Session().authorized(ctx, async () => {
        throw new EcomError("auth_required", "expired");
      }),
    ).rejects.toThrow("ecom login magnit");
  });

  test("asks to sign in when there is no session", async () => {
    const { ctx, calls } = setup({});

    await expect(
      new Session().authorized(ctx, async () => "never"),
    ).rejects.toMatchObject({ code: "auth_required" });
    expect(calls).toHaveLength(0);
  });
});
