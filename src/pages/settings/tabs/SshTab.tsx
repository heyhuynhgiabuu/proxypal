import type { Accessor, Setter } from "solid-js";
import { createMemo, For, Show } from "solid-js";

import { Button, Switch } from "../../../components/ui";
import type { SshConfig, SshStatusUpdate } from "../../../lib/tauri";

interface SshTabProps {
	active: boolean;
	sshConfigs: Accessor<SshConfig[]>;
	sshStatus: Accessor<Record<string, SshStatusUpdate>>;
	onToggle: (id: string, enabled: boolean) => void;
	onEdit: (ssh: SshConfig) => void;
	onDelete: (id: string) => void;

	sshId: Accessor<string>;
	sshHost: Accessor<string>;
	setSshHost: Setter<string>;
	sshPort: Accessor<number>;
	setSshPort: Setter<number>;
	sshUser: Accessor<string>;
	setSshUser: Setter<string>;
	sshPass: Accessor<string>;
	setSshPass: Setter<string>;
	sshKey: Accessor<string>;
	setSshKey: Setter<string>;
	sshRemote: Accessor<number>;
	setSshRemote: Setter<number>;
	sshLocal: Accessor<number>;
	setSshLocal: Setter<number>;

	sshAdding: Accessor<boolean>;
	onPickKeyFile: () => void;
	onSave: () => void;
	onCancelEdit: () => void;
}

export const SshTab = (props: SshTabProps) => (
	<div class="space-y-4" classList={{ hidden: !props.active }}>
		<h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
			SSH API Connections
		</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Securely tunnel your local API (port 8317) to a remote server for shared
			access.
		</p>

		<div class="space-y-3">
			<For each={props.sshConfigs()}>
				{(ssh) => {
					const statusProps = createMemo(() => {
						const status = props.sshStatus()[ssh.id] || {
							id: ssh.id,
							status: ssh.enabled ? "connecting" : "disconnected",
							message: undefined,
						};

						let displayStatus = status.status;
						const displayMessage = status.message;

						if (ssh.enabled) {
							if (!displayStatus || displayStatus === "disconnected") {
								displayStatus = "connecting";
							}
						} else if (
							displayStatus === "connected" ||
							displayStatus === "connecting"
						) {
							displayStatus = "disconnected";
						}

						return { status: displayStatus, message: displayMessage };
					});

					return (
						<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<div class="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
									<span>
										{ssh.username}@{ssh.host}:{ssh.port}
									</span>
								</div>
								<div class="text-xs text-gray-500 mt-1">
									Forward: Remote :{ssh.remotePort} &rarr; Local :{ssh.localPort}
								</div>
								<Show when={statusProps().message}>
									<div
										class={`text-xs mt-1 break-all flex items-start gap-1 ${statusProps().status === "error"
												? "text-red-500"
												: "text-gray-500"
											}`}
									>
										<span class="opacity-75">&gt;</span>
										<span>{statusProps().message}</span>
									</div>
								</Show>
							</div>
							<div class="flex items-center gap-4">
								<div class="flex items-center gap-2">
									<div
										class={`w-2.5 h-2.5 rounded-full ${statusProps().status === "connected"
												? "bg-green-500"
												: statusProps().status === "error"
													? "bg-red-500"
													: statusProps().status === "connecting" ||
														statusProps().status === "reconnecting"
														? "bg-orange-500 animate-pulse"
														: "bg-gray-400"
											}`}
									/>
									<span class="text-sm font-medium text-gray-600 dark:text-gray-400 capitalize min-w-[50px]">
										{statusProps().status}
									</span>
								</div>
								<div class="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
								<Switch
									checked={ssh.enabled}
									onChange={(val) => props.onToggle(ssh.id, val)}
								/>
								<button
									class="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
									title="Edit Connection"
									onClick={() => props.onEdit(ssh)}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="w-4 h-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
										/>
									</svg>
								</button>
								<button
									class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
									title="Delete Connection"
									onClick={() => props.onDelete(ssh.id)}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="w-4 h-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							</div>
						</div>
					);
				}}
			</For>

			<Show when={props.sshConfigs().length === 0}>
				<div class="text-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
					No SSH connections configured
				</div>
			</Show>
		</div>

		<div class="p-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="font-medium text-gray-900 dark:text-gray-100">
					{props.sshId() ? "Edit Connection" : "Add New Connection"}
				</h3>
				<Show when={props.sshId()}>
					<button
						onClick={props.onCancelEdit}
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
					>
						Cancel Edit
					</button>
				</Show>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Host / IP
					</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
						placeholder="e.g. 192.168.1.1 or vps.example.com"
						value={props.sshHost()}
						onInput={(e) => props.setSshHost(e.currentTarget.value)}
					/>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">Port</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
						placeholder="22"
						type="number"
						value={props.sshPort()}
						onInput={(e) => props.setSshPort(parseInt(e.currentTarget.value) || 22)}
					/>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Username
					</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
						placeholder="root"
						value={props.sshUser()}
						onInput={(e) => props.setSshUser(e.currentTarget.value)}
					/>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Password (Not Supported)
					</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-sm cursor-not-allowed"
						placeholder="Password auth not supported - Use Key File"
						type="password"
						disabled
						value={props.sshPass()}
						onInput={(e) => props.setSshPass(e.currentTarget.value)}
					/>
					<p class="text-[10px] text-orange-500">
						Note: Password authentication is not supported. Please use a Private
						Key file.
					</p>
				</div>
				<div class="col-span-1 sm:col-span-2 space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Private Key File
					</label>
					<div class="flex gap-2">
						<input
							class="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
							placeholder="/path/to/private_key"
							value={props.sshKey()}
							onInput={(e) => props.setSshKey(e.currentTarget.value)}
						/>
						<button
							class="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium rounded-lg transition-colors"
							onClick={props.onPickKeyFile}
						>
							Browse
						</button>
					</div>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Remote Port (VPS)
					</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
						placeholder="8317"
						type="number"
						value={props.sshRemote()}
						onInput={(e) => props.setSshRemote(parseInt(e.currentTarget.value) || 0)}
					/>
					<p class="text-[10px] text-gray-400">Port to open on the remote server</p>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-gray-500 uppercase">
						Local Port (This App)
					</label>
					<input
						class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
						placeholder="8317"
						type="number"
						value={props.sshLocal()}
						onInput={(e) => props.setSshLocal(parseInt(e.currentTarget.value) || 0)}
					/>
					<p class="text-[10px] text-gray-400">
						Port running locally (default 8317)
					</p>
				</div>
			</div>
			<div class="pt-2">
				<Button
					onClick={props.onSave}
					loading={props.sshAdding()}
					variant="primary"
					class="w-full sm:w-auto"
				>
					{props.sshId() ? "Update Connection" : "Add Connection"}
				</Button>
			</div>
		</div>
	</div>
);
