import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { getSession } from "./session";

export type ThemeMode = "light" | "dark" | "system";
export const THEME_COOKIE = "il_theme";
export const THEME_KEY = "theme.default";
export const OVERRIDE_KEY = "theme.allowUserOverride";

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

/** Platform-wide theme settings from the AppConfig table (defaults: dark, user override allowed). */
export async function getPlatformTheme(): Promise<{ mode: ThemeMode; allowUserOverride: boolean }> {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: [THEME_KEY, OVERRIDE_KEY] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const mode = map.get(THEME_KEY);
  const override = map.get(OVERRIDE_KEY);
  return {
    mode: isThemeMode(mode) ? mode : "dark",
    allowUserOverride: typeof override === "boolean" ? override : true,
  };
}

export function gymThemeFromSettings(settings: unknown): ThemeMode | null {
  const t = (settings as { theme?: unknown } | null)?.theme;
  return isThemeMode(t) ? t : null;
}

/**
 * Precedence: the user's own choice (cookie, if the platform allows overrides)
 * > their gym's setting (staff/member sessions) > platform default > "dark".
 */
export async function resolveTheme(): Promise<{ mode: ThemeMode; allowUserOverride: boolean }> {
  // Read cookies outside the try/catch: it marks the page as dynamic by throwing, and that
  // signal must reach Next instead of being swallowed by the fail-soft handler below.
  const userChoice = cookies().get(THEME_COOKIE)?.value;
  try {
    return await resolveThemeUnsafe(userChoice);
  } catch (err) {
    // Theming is cosmetic: never let a DB hiccup break every page that renders the root layout.
    console.error("Theme resolution failed, falling back to dark", err);
    return { mode: "dark", allowUserOverride: true };
  }
}

async function resolveThemeUnsafe(userChoice: string | undefined): Promise<{ mode: ThemeMode; allowUserOverride: boolean }> {
  const platform = await getPlatformTheme();

  if (platform.allowUserOverride) {
    if (isThemeMode(userChoice)) return { mode: userChoice, allowUserOverride: true };
  }

  const session = await getSession();
  if (session && session.kind !== "superadmin") {
    const gym = await prisma.gym.findUnique({ where: { id: session.gymId }, select: { settings: true } });
    const gymTheme = gymThemeFromSettings(gym?.settings);
    if (gymTheme) return { mode: gymTheme, allowUserOverride: platform.allowUserOverride };
  }

  return platform;
}
