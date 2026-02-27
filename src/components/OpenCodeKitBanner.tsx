import { openUrl } from "@tauri-apps/plugin-opener";

export function OpenCodeKitBanner() {
  const handleVisit = async () => {
    try {
      await openUrl("https://opencodekit.xyz/");
    } catch (error) {
      console.error("Failed to open URL:", error);
      // Fallback to window.open
      window.open("https://opencodekit.xyz/", "_blank");
    }
  };

  return (
    <div class="relative overflow-hidden rounded-xl shadow-xl">
      {/* Background - dark professional theme */}
      <div class="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" />

      {/* Green accent line at top - OpenCodeKit brand color #10B981 */}
      <div class="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />

      {/* Content */}
      <div class="relative flex items-center justify-between gap-4 px-4 py-5 sm:px-6">
        {/* Left: Logo and Text */}
        <div class="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          {/* OpenCodeKit Logo */}
          <div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg sm:h-14 sm:w-14">
            <img
              alt="OpenCodeKit"
              class="h-12 w-12 object-contain sm:h-14 sm:w-14"
              src="/logos/opencodekit.svg"
            />
          </div>

          {/* Text Content */}
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center gap-2">
              <h3 class="text-sm font-bold text-white sm:text-base">OpenCodeKit</h3>
              <span class="inline-block rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white sm:text-xs">
                PRO CONFIG
              </span>
            </div>
            <p class="line-clamp-2 text-xs text-slate-300 sm:text-sm">
              Production-ready configuration for OpenCode. Get the best AI coding experience.
            </p>
          </div>
        </div>

        {/* Right: Action Button */}
        <div class="flex flex-shrink-0 items-center">
          <button
            class="whitespace-nowrap rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-all duration-200 hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/25 sm:px-4 sm:text-sm"
            onClick={handleVisit}
          >
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
}
