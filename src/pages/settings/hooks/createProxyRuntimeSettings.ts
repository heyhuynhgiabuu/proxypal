import type { Accessor } from "solid-js";
import { createEffect, createSignal } from "solid-js";

import {
	deleteOAuthExcludedModels,
	getAvailableModels,
	getForceModelMappings,
	getMaxRetryInterval,
	getOAuthExcludedModels,
	getReasoningEffortSettings,
	getThinkingBudgetSettings,
	getThinkingBudgetTokens,
	getWebsocketAuth,
	setForceModelMappings,
	setMaxRetryInterval,
	setOAuthExcludedModels,
	setReasoningEffortSettings,
	setThinkingBudgetSettings,
	setWebsocketAuth,
	type AvailableModel,
	type OAuthExcludedModels,
	type ReasoningEffortLevel,
	type ThinkingBudgetSettings,
} from "../../../lib/tauri";
import { toastStore } from "../../../stores/toast";

export function createProxyRuntimeSettings(proxyRunning: Accessor<boolean>) {
	const [availableModels, setAvailableModels] = createSignal<AvailableModel[]>(
		[],
	);

	const [maxRetryInterval, setMaxRetryIntervalState] = createSignal<number>(0);
	const [websocketAuth, setWebsocketAuthState] = createSignal<boolean>(false);
	const [forceModelMappings, setForceModelMappingsState] =
		createSignal<boolean>(false);
	const [savingMaxRetryInterval, setSavingMaxRetryInterval] =
		createSignal(false);
	const [savingWebsocketAuth, setSavingWebsocketAuth] = createSignal(false);
	const [savingForceModelMappings, setSavingForceModelMappings] =
		createSignal(false);

	const [thinkingBudgetMode, setThinkingBudgetMode] =
		createSignal<ThinkingBudgetSettings["mode"]>("medium");
	const [thinkingBudgetCustom, setThinkingBudgetCustom] = createSignal(16000);
	const [savingThinkingBudget, setSavingThinkingBudget] = createSignal(false);

	const [reasoningEffortLevel, setReasoningEffortLevel] =
		createSignal<ReasoningEffortLevel>("medium");
	const [savingReasoningEffort, setSavingReasoningEffort] = createSignal(false);

	const [oauthExcludedModels, setOAuthExcludedModelsState] =
		createSignal<OAuthExcludedModels>({});
	const [loadingExcludedModels, setLoadingExcludedModels] = createSignal(false);
	const [savingExcludedModels, setSavingExcludedModels] = createSignal(false);
	const [newExcludedProvider, setNewExcludedProvider] = createSignal("");
	const [newExcludedModel, setNewExcludedModel] = createSignal("");

	createEffect(async () => {
		if (!proxyRunning()) {
			setAvailableModels([]);
			return;
		}

		try {
			const models = await getAvailableModels();
			setAvailableModels(models);
		} catch (error) {
			console.error("Failed to fetch available models:", error);
			setAvailableModels([]);
		}

		try {
			const interval = await getMaxRetryInterval();
			setMaxRetryIntervalState(interval);
		} catch (error) {
			console.error("Failed to fetch max retry interval:", error);
		}

		try {
			const wsAuth = await getWebsocketAuth();
			setWebsocketAuthState(wsAuth);
		} catch (error) {
			console.error("Failed to fetch WebSocket auth:", error);
		}

		try {
			const prioritize = await getForceModelMappings();
			setForceModelMappingsState(prioritize);
		} catch (error) {
			console.error("Failed to fetch prioritize model mappings:", error);
		}

		try {
			const thinkingSettings = await getThinkingBudgetSettings();
			setThinkingBudgetMode(thinkingSettings.mode);
			setThinkingBudgetCustom(thinkingSettings.customBudget);
		} catch (error) {
			console.error("Failed to fetch thinking budget settings:", error);
		}

		try {
			const reasoningSettings = await getReasoningEffortSettings();
			setReasoningEffortLevel(reasoningSettings.level);
		} catch (error) {
			console.error("Failed to fetch reasoning effort settings:", error);
		}

		try {
			setLoadingExcludedModels(true);
			const excluded = await getOAuthExcludedModels();
			setOAuthExcludedModelsState(excluded);
		} catch (error) {
			console.error("Failed to fetch OAuth excluded models:", error);
		} finally {
			setLoadingExcludedModels(false);
		}
	});

	const handleMaxRetryIntervalChange = async (value: number) => {
		setSavingMaxRetryInterval(true);
		try {
			await setMaxRetryInterval(value);
			setMaxRetryIntervalState(value);
			toastStore.success("Max retry interval updated");
		} catch (error) {
			toastStore.error("Failed to update max retry interval", String(error));
		} finally {
			setSavingMaxRetryInterval(false);
		}
	};

	const handleWebsocketAuthChange = async (value: boolean) => {
		setSavingWebsocketAuth(true);
		try {
			await setWebsocketAuth(value);
			setWebsocketAuthState(value);
			toastStore.success(
				`WebSocket authentication ${value ? "enabled" : "disabled"}`,
			);
		} catch (error) {
			toastStore.error("Failed to update WebSocket auth", String(error));
		} finally {
			setSavingWebsocketAuth(false);
		}
	};

	const handleForceModelMappingsChange = async (value: boolean) => {
		setSavingForceModelMappings(true);
		try {
			await setForceModelMappings(value);
			setForceModelMappingsState(value);
			toastStore.success(
				`Model mapping priority ${value ? "enabled" : "disabled"}`,
				value
					? "Model mappings now take precedence over local API keys"
					: "Local API keys now take precedence over model mappings",
			);
		} catch (error) {
			toastStore.error(
				"Failed to update model mapping priority",
				String(error),
			);
		} finally {
			setSavingForceModelMappings(false);
		}
	};

	const saveThinkingBudget = async () => {
		setSavingThinkingBudget(true);
		try {
			await setThinkingBudgetSettings({
				mode: thinkingBudgetMode(),
				customBudget: thinkingBudgetCustom(),
			});
			const tokens = getThinkingBudgetTokens({
				mode: thinkingBudgetMode(),
				customBudget: thinkingBudgetCustom(),
			});
			toastStore.success(
				`Thinking budget updated to ${tokens} tokens`,
			);
		} catch (error) {
			console.error("Failed to save thinking budget:", error);
			toastStore.error("Failed to save thinking budget", String(error));
		} finally {
			setSavingThinkingBudget(false);
		}
	};

	const saveReasoningEffort = async () => {
		setSavingReasoningEffort(true);
		try {
			await setReasoningEffortSettings({ level: reasoningEffortLevel() });
			toastStore.success(`Reasoning effort updated to "${reasoningEffortLevel()}"`);
		} catch (error) {
			console.error("Failed to save reasoning effort:", error);
			toastStore.error("Failed to save reasoning effort", String(error));
		} finally {
			setSavingReasoningEffort(false);
		}
	};

	const handleAddExcludedModel = async () => {
		const provider = newExcludedProvider().trim().toLowerCase();
		const model = newExcludedModel().trim();

		if (!provider || !model) {
			toastStore.error("Provider and model are required");
			return;
		}

		setSavingExcludedModels(true);
		try {
			const current = oauthExcludedModels();
			const existing = current[provider] || [];
			if (existing.includes(model)) {
				toastStore.error("Model already excluded for this provider");
				return;
			}

			const updated = [...existing, model];
			await setOAuthExcludedModels(provider, updated);
			setOAuthExcludedModelsState({ ...current, [provider]: updated });
			setNewExcludedModel("");
			toastStore.success(`Model "${model}" excluded for ${provider}`);
		} catch (error) {
			toastStore.error("Failed to add excluded model", String(error));
		} finally {
			setSavingExcludedModels(false);
		}
	};

	const handleRemoveExcludedModel = async (provider: string, model: string) => {
		setSavingExcludedModels(true);
		try {
			const current = oauthExcludedModels();
			const existing = current[provider] || [];
			const updated = existing.filter((m) => m !== model);

			if (updated.length === 0) {
				await deleteOAuthExcludedModels(provider);
				const newState = { ...current };
				delete newState[provider];
				setOAuthExcludedModelsState(newState);
			} else {
				await setOAuthExcludedModels(provider, updated);
				setOAuthExcludedModelsState({ ...current, [provider]: updated });
			}
			toastStore.success(`Model "${model}" removed from ${provider}`);
		} catch (error) {
			toastStore.error("Failed to remove excluded model", String(error));
		} finally {
			setSavingExcludedModels(false);
		}
	};

	return {
		availableModels,
		maxRetryInterval,
		websocketAuth,
		forceModelMappings,
		savingMaxRetryInterval,
		savingWebsocketAuth,
		savingForceModelMappings,
		handleMaxRetryIntervalChange,
		handleWebsocketAuthChange,
		handleForceModelMappingsChange,
		thinkingBudgetMode,
		setThinkingBudgetMode,
		thinkingBudgetCustom,
		setThinkingBudgetCustom,
		savingThinkingBudget,
		saveThinkingBudget,
		reasoningEffortLevel,
		setReasoningEffortLevel,
		savingReasoningEffort,
		saveReasoningEffort,
		oauthExcludedModels,
		loadingExcludedModels,
		savingExcludedModels,
		newExcludedProvider,
		setNewExcludedProvider,
		newExcludedModel,
		setNewExcludedModel,
		handleAddExcludedModel,
		handleRemoveExcludedModel,
	};
}

