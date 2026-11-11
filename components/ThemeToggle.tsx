"use client";
import { useEffect, useState } from "react";
import { applyThemePref, nextThemePref, readThemePref, type ThemePref } from "@/lib/theme";
import { Icon } from "./icons";

const LABEL: Record<ThemePref, string> = { system: "Theme: match system", light: "Theme: light", dark: "Theme: dark" };
const ICON: Record<ThemePref, string> = { system: "monitor", light: "sun", dark: "moon" };

/** Cycles system → light → dark. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref | null>(null);
  useEffect(() => setPref(readThemePref()), []);

  const current = pref ?? "system";
  const next = nextThemePref(current);
  return (
    <button
      type="button"
      className="bt-iconbtn"
      onClick={() => {
        applyThemePref(next);
        setPref(next);
      }}
      title={`${LABEL[current]} (switch to ${next})`}
      aria-label={`${LABEL[current]}. Switch to ${next}.`}
    >
      {/* Render nothing until mounted so the server HTML never disagrees with the stored choice. */}
      {pref && <Icon name={ICON[current]} size={17} />}
    </button>
  );
}
