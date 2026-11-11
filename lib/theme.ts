export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "clawback-theme";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];

/** Browser chrome color per system scheme: brand green in light, --paper (globals.css) in dark. */
export const THEME_COLORS = { light: "#0F6E4E", dark: "#0D1411" } as const;

/**
 * Runs in <head> before first paint so a stored light/dark choice applies
 * without a flash. "system" (or nothing stored) leaves data-theme unset and
 * the prefers-color-scheme media query in globals.css takes over.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export function readThemePref(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyThemePref(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked (private mode etc.): the choice still applies for this page view.
  }
}

export function nextThemePref(pref: ThemePref): ThemePref {
  return THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
}
