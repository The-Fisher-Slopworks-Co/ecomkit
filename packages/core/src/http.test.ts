import { describe, expect, test } from "bun:test";
import { EcomError, type EcomErrorCode } from "./errors.ts";
import { createHttpClient } from "./http.ts";

function recordingFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { calls, fetch };
}

async function failWithApiKey() {
  return new Response("{}", { status: 500, headers: { "x-api-key": "k" } });
}

describe("createHttpClient", () => {
  test("builds the URL, sends JSON and parses the response", async () => {
    const { calls, fetch } = recordingFetch(200, '{"ok":true}');
    const http = createHttpClient({
      baseUrl: "https://api.example.com/v1/",
      headers: { authorization: "Bearer t" },
      fetch,
    });

    const result = await http.post<{ ok: boolean }>("items", {
      query: { q: "молоко", limit: 5, skip: undefined },
      body: { id: 1 },
    });

    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe(
      "https://api.example.com/v1/items?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE&limit=5",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"id":1}');
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer t",
      "content-type": "application/json",
    });
  });

  test.each<[number, EcomErrorCode]>([
    [401, "auth_required"],
    [404, "not_found"],
    [500, "http"],
  ])("maps status %d to %s", async (status, code) => {
    const { fetch } = recordingFetch(status, '{"message":"no"}');
    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      fetch,
    });

    const error = await http.get("/x").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EcomError);
    expect((error as EcomError).code).toBe(code);
    expect((error as EcomError).details).toEqual({
      status,
      body: { message: "no" },
    });
  });

  test("shows the response headers to the request, also on errors", async () => {
    const http = createHttpClient({
      baseUrl: "https://api.example.com/",
      fetch: failWithApiKey,
    });
    const seen: (string | null)[] = [];

    await expect(
      http.get("items", { onResponse: (h) => seen.push(h.get("x-api-key")) }),
    ).rejects.toThrow(EcomError);

    expect(seen).toEqual(["k"]);
  });

  test("keeps requests under the base URL", async () => {
    const { calls, fetch } = recordingFetch(200, "");
    const http = createHttpClient({
      baseUrl: "https://api.example.com/v1",
      fetch,
    });

    await http.get("/products/1");
    expect(calls[0]?.url).toBe("https://api.example.com/v1/products/1");

    for (const path of [
      "//evil.example/x",
      "https://evil.example/x",
      "../admin",
      "a/../../admin",
    ]) {
      await expect(http.get(path)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
  });

  test("wraps network failures", async () => {
    const http = createHttpClient({
      baseUrl: "https://api.example.com",
      fetch: async () => {
        throw new TypeError("connection refused");
      },
    });

    await expect(http.get("/x")).rejects.toMatchObject({ code: "http" });
  });
});
