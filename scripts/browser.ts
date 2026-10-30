import { existsSync } from "node:fs";

/** Prefer an explicit override, then Playwright's browser, then a Linux system install. */
export function resolveChromiumPath({
  override,
  managedPath,
  exists = existsSync,
  platform = process.platform,
}: {
  override?: string;
  managedPath: string;
  exists?: (path: string) => boolean;
  platform?: string;
}): string | undefined {
  if (override) {
    if (!exists(override)) {
      throw new Error(
        `CHROMIUM_PATH does not exist: ${override}. Set it to an installed browser or unset it and run npx playwright install --with-deps chromium.`,
      );
    }
    return override;
  }
  // Omitting executablePath lets Playwright choose its matching managed build.
  if (exists(managedPath)) return undefined;
  if (platform === "linux") {
    return ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(exists);
  }
  return undefined;
}
