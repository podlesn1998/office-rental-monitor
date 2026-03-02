/**
 * In-memory scrape progress state.
 * Updated by the scraper pipeline and read by the tRPC progress query.
 */

export type PlatformStatus = "idle" | "running" | "done" | "error" | "skipped";

export interface PlatformProgress {
  status: PlatformStatus;
  found: number;
  newCount: number;
  error?: string;
}

export interface ScrapeProgress {
  isRunning: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  platforms: {
    cian: PlatformProgress;
    avito: PlatformProgress;
    yandex: PlatformProgress;
  };
}

const defaultPlatform = (): PlatformProgress => ({
  status: "idle",
  found: 0,
  newCount: 0,
});

export const scrapeProgress: ScrapeProgress = {
  isRunning: false,
  startedAt: null,
  finishedAt: null,
  platforms: {
    cian: defaultPlatform(),
    avito: defaultPlatform(),
    yandex: defaultPlatform(),
  },
};

export function resetProgress(platforms: ("cian" | "avito" | "yandex")[]) {
  scrapeProgress.isRunning = true;
  scrapeProgress.startedAt = new Date();
  scrapeProgress.finishedAt = null;
  scrapeProgress.platforms.cian = platforms.includes("cian")
    ? { status: "running", found: 0, newCount: 0 }
    : { status: "skipped", found: 0, newCount: 0 };
  scrapeProgress.platforms.avito = platforms.includes("avito")
    ? { status: "running", found: 0, newCount: 0 }
    : { status: "skipped", found: 0, newCount: 0 };
  scrapeProgress.platforms.yandex = platforms.includes("yandex")
    ? { status: "running", found: 0, newCount: 0 }
    : { status: "skipped", found: 0, newCount: 0 };
}

export function updatePlatformProgress(
  platform: "cian" | "avito" | "yandex",
  status: PlatformStatus,
  found: number,
  newCount: number,
  error?: string
) {
  scrapeProgress.platforms[platform] = { status, found, newCount, error };
}

export function finishProgress() {
  scrapeProgress.isRunning = false;
  scrapeProgress.finishedAt = new Date();
}
