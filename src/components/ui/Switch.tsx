import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { splitProps } from "solid-js";

interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
}

export function Switch(props: SwitchProps) {
  const [local] = splitProps(props, [
    "checked",
    "onChange",
    "disabled",
    "label",
    "description",
  ]);

  return (
    <KobalteSwitch
      class="flex items-center justify-between"
      checked={local.checked}
      onChange={local.onChange}
      disabled={local.disabled}
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
      <KobalteSwitch.Control class="w-11 h-6 bg-gray-200 dark:bg-gray-700 rounded-full relative transition-colors data-[checked]:bg-brand-600 cursor-pointer">
        <KobalteSwitch.Thumb class="block w-5 h-5 bg-white rounded-full shadow-md transform transition-transform translate-x-0.5 data-[checked]:translate-x-[22px] mt-0.5" />
      </KobalteSwitch.Control>
    </KobalteSwitch>
  );
}
