import { createEffect, createRoot, createSignal, onCleanup } from "solid-js";

export type Theme = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "theme";

function isTheme(value: string | null): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): "light" | "dark" {
	if (typeof window !== "undefined") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	}

	return "light";
}

function readStoredTheme(): Theme {
	if (typeof window === "undefined") {
		return "system";
	}

	try {
		const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
		return isTheme(savedTheme) ? savedTheme : "system";
	} catch (error) {
		console.warn("Failed to read saved theme:", error);
		return "system";
	}
}

function persistTheme(theme: Theme) {
	if (typeof window === "undefined") {
		return;
	}

	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch (error) {
		console.warn("Failed to save theme preference:", error);
	}
}

function createThemeStore() {
	const [theme, setTheme] = createSignal<Theme>(readStoredTheme());

	const resolvedTheme = () => {
		const currentTheme = theme();
		if (currentTheme === "system") {
			return getSystemTheme();
		}

		return currentTheme;
	};

	createEffect(() => {
		if (typeof document === "undefined") {
			return;
		}

		const root = document.documentElement;
		if (resolvedTheme() === "dark") {
			root.classList.add("dark");
		} else {
			root.classList.remove("dark");
		}

		persistTheme(theme());
	});

	if (typeof window !== "undefined") {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleSystemThemeChange = () => {
			if (theme() !== "system" || typeof document === "undefined") {
				return;
			}

			if (getSystemTheme() === "dark") {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
		};

		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", handleSystemThemeChange);
			onCleanup(() => {
				mediaQuery.removeEventListener("change", handleSystemThemeChange);
			});
		} else {
			mediaQuery.addListener(handleSystemThemeChange);
			onCleanup(() => {
				mediaQuery.removeListener(handleSystemThemeChange);
			});
		}
	}

	const cycleTheme = () => {
		const currentTheme = theme();
		if (currentTheme === "system") {
			setTheme("light");
		} else if (currentTheme === "light") {
			setTheme("dark");
		} else {
			setTheme("system");
		}
	};

	return {
		theme,
		setTheme,
		resolvedTheme,
		cycleTheme,
	};
}

export const themeStore = createRoot(createThemeStore);
