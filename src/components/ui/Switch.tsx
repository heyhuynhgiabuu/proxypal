import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { splitProps } from "solid-js";

interface SwitchProps {
  checked?: boolean;
  description?: string;
  disabled?: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
}

export function Switch(props: SwitchProps) {
  const [local] = splitProps(props, ["checked", "onChange", "disabled", "label", "description"]);

  return (
    <KobalteSwitch
      checked={local.checked}
      class="flex items-center justify-between"
      disabled={local.disabled}
      onChange={local.onChange}
    >
      <div class="flex flex-col">
        {local.label && (
          <KobalteSwitch.Label class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {local.label}
          </KobalteSwitch.Label>
        )}
        {local.description && (
          <KobalteSwitch.Description class="text-sm text-gray-500 dark:text-gray-400">
            {local.description}
          </KobalteSwitch.Description>
        )}
      </div>
      <KobalteSwitch.Input class="sr-only" />
      <KobalteSwitch.Control class="relative h-6 w-11 cursor-pointer rounded-full bg-gray-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ui-checked:bg-green-500 dark:bg-gray-600 dark:ui-checked:bg-green-500">
        <KobalteSwitch.Thumb class="mt-0.5 block h-5 w-5 translate-x-0.5 transform rounded-full bg-white shadow-md transition-transform ui-checked:translate-x-[22px]" />
      </KobalteSwitch.Control>
    </KobalteSwitch>
  );
}
