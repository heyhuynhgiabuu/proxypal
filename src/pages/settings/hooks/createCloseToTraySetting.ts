import { createEffect, createSignal } from "solid-js";

import { getCloseToTray, setCloseToTray } from "../../../lib/tauri";
import { toastStore } from "../../../stores/toast";

export function createCloseToTraySetting() {
	const [closeToTray, setCloseToTrayState] = createSignal(true);
	const [savingCloseToTray, setSavingCloseToTray] = createSignal(false);

	createEffect(async () => {
		try {
			const enabled = await getCloseToTray();
			setCloseToTrayState(enabled);
		} catch (error) {
			console.error("Failed to fetch close to tray setting:", error);
		}
	});

	const handleCloseToTrayChange = async (enabled: boolean) => {
		setSavingCloseToTray(true);
		try {
			await setCloseToTray(enabled);
			setCloseToTrayState(enabled);
			toastStore.success(
				enabled
					? "Window will minimize to tray when closed"
					: "Window will quit when closed",
			);
		} catch (error) {
			console.error("Failed to save close to tray setting:", error);
			toastStore.error(`Failed to save setting: ${error}`);
		} finally {
			setSavingCloseToTray(false);
		}
	};

	return { closeToTray, savingCloseToTray, handleCloseToTrayChange };
}

