/**
 * Theme management for the Lore dashboard.
 * Purpose: three-state theme hook (light/dark/system) backed by localStorage.
 * Public surface: useTheme, ThemeProvider
 * Invariants: applies/removes "dark" class on documentElement; system preference is read via matchMedia.
 * Side-effect class: stateful + DOM writes (class on <html>)
 */

import React, { createContext, useContext, useEffect, useState } from "react";

/** The three supported theme values. */
export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => undefined,
});

const STORAGE_KEY = "lore-theme";

/**
 * Resolve the effective display theme from a Theme value.
 * "system" defers to the OS media preference.
 */
function resolveEffectiveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the resolved theme by toggling "dark" class on the root element.
 * @param theme - User-selected or system-resolved theme.
 */
function applyTheme(theme: Theme): void {
  const effective = resolveEffectiveTheme(theme);
  const root = document.documentElement;
  if (effective === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * Provider that reads theme from localStorage and syncs it to the DOM.
 * Wrap the app root in this component once.
 *
 * @example
 * <ThemeProvider><App /></ThemeProvider>
 */
export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {
      // localStorage may be unavailable in some environments
    }
    return "system";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setTheme(next: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore localStorage failures
    }
    setThemeState(next);
  }

  return React.createElement(ThemeContext.Provider, { value: { theme, setTheme } }, children);
}

/**
 * Access the current theme and setter.
 * Must be used inside ThemeProvider.
 *
 * @returns { theme, setTheme }
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
