import { describe, it, expect } from "vitest";

describe("RuCaptcha API Key", () => {
  it("should have RUCAPTCHA_API_KEY set", () => {
    const key = process.env.RUCAPTCHA_API_KEY;
    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should return valid balance from rucaptcha.com", async () => {
    const key = process.env.RUCAPTCHA_API_KEY;
    if (!key) {
      console.warn("RUCAPTCHA_API_KEY not set, skipping live test");
      return;
    }

    const url = `https://rucaptcha.com/res.php?action=getbalance&key=${encodeURIComponent(key)}&json=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await resp.json() as { status: number; request: string };

    expect(data.status).toBe(1);
    const balance = parseFloat(data.request);
    expect(balance).toBeGreaterThanOrEqual(0);
    console.log(`RuCaptcha balance: $${balance}`);
  }, 15000);
});
