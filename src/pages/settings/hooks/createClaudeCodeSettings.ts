import { createEffect, createSignal } from "solid-js";

import { getClaudeCodeSettings, setClaudeCodeModel } from "../../../lib/tauri";
import type { ClaudeCodeSettings } from "../../../lib/tauri";
import { toastStore } from "../../../stores/toast";

export function createClaudeCodeSettings() {
	const [claudeCodeSettings, setClaudeCodeSettings] =
		createSignal<ClaudeCodeSettings>({
			haikuModel: null,
			opusModel: null,
			sonnetModel: null,
			baseUrl: null,
			authToken: null,
		});

	createEffect(async () => {
		try {
			const settings = await getClaudeCodeSettings();
			setClaudeCodeSettings(settings);
		} catch (error) {
			console.error("Failed to fetch Claude Code settings:", error);
		}
	});

	const handleClaudeCodeSettingChange = async (
		modelType: "haikuModel" | "opusModel" | "sonnetModel",
		modelName: string,
	) => {
		try {
			const backendModelType = modelType.replace("Model", "") as
				| "haiku"
				| "opus"
				| "sonnet";
			await setClaudeCodeModel(backendModelType, modelName);
			setClaudeCodeSettings((prev) => ({
				...prev,
				[modelType]: modelName || null,
			}));
			toastStore.success("Claude Code model updated");
		} catch (error) {
			console.error("Failed to save Claude Code setting:", error);
			toastStore.error(`Failed to save setting: ${error}`);
		}
	};

	return { claudeCodeSettings, handleClaudeCodeSettingChange };
}

