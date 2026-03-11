import { describe, it, expect } from "vitest";

describe("ProxyLine API Key", () => {
  it("should return valid response from proxyline API", async () => {
    const apiKey = process.env.PROXYLINE_API_KEY;
    expect(apiKey, "PROXYLINE_API_KEY must be set").toBeTruthy();

    const res = await fetch(
      `https://panel.proxyline.net/api/balance/?api_key=${apiKey}`
    );
    expect(res.status, "ProxyLine API should return 200").toBe(200);

    const data = await res.json() as any;
    console.log("ProxyLine balance:", JSON.stringify(data));
    // Should have a balance field (not an error)
    expect(data).not.toHaveProperty("detail");
  });

  it("should return proxy list (even if empty)", async () => {
    const apiKey = process.env.PROXYLINE_API_KEY;
    const res = await fetch(
      `https://panel.proxyline.net/api/proxies/?api_key=${apiKey}&status=active&limit=10`
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    console.log("ProxyLine proxies count:", data.count ?? data.results?.length ?? 0);
    expect(data).toHaveProperty("results");
  });
});
