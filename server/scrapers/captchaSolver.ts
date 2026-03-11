import { ENV } from "../_core/env";

const IN_URL = "https://rucaptcha.com/in.php";
const RES_URL = "https://rucaptcha.com/res.php";

/**
 * Submit a Yandex SmartCaptcha task to rucaptcha.com and wait for the token.
 * Returns the solved token string, or null if solving failed / key not configured.
 */
export async function solveYandexSmartCaptcha(
  pageUrl: string,
  siteKey: string
): Promise<string | null> {
  const apiKey = ENV.rucaptchaApiKey;
  if (!apiKey) {
    console.warn("[RuCaptcha] RUCAPTCHA_API_KEY not set, skipping captcha solve");
    return null;
  }

  try {
    // Step 1: Submit task
    const submitUrl =
      `${IN_URL}?key=${encodeURIComponent(apiKey)}` +
      `&method=yandex` +
      `&sitekey=${encodeURIComponent(siteKey)}` +
      `&pageurl=${encodeURIComponent(pageUrl)}` +
      `&json=1`;

    const submitResp = await fetch(submitUrl, { signal: AbortSignal.timeout(15000) });
    const submitData = await submitResp.json() as { status: number; request: string };

    if (submitData.status !== 1) {
      console.warn("[RuCaptcha] Task submission failed:", submitData.request);
      return null;
    }

    const taskId = submitData.request;
    console.log(`[RuCaptcha] Task submitted, id=${taskId}`);

    // Step 2: Poll for result (up to 120 seconds, every 5 seconds)
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));

      const pollUrl =
        `${RES_URL}?key=${encodeURIComponent(apiKey)}` +
        `&action=get` +
        `&id=${taskId}` +
        `&json=1`;

      const pollResp = await fetch(pollUrl, { signal: AbortSignal.timeout(10000) });
      const pollData = await pollResp.json() as { status: number; request: string };

      if (pollData.status === 1) {
        console.log(`[RuCaptcha] Captcha solved after ${(attempt + 1) * 5}s`);
        return pollData.request;
      }

      if (pollData.request !== "CAPCHA_NOT_READY") {
        console.warn("[RuCaptcha] Polling error:", pollData.request);
        return null;
      }
    }

    console.warn("[RuCaptcha] Timeout waiting for captcha solution");
    return null;
  } catch (err) {
    console.error("[RuCaptcha] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
