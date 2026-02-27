/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  plugins: [require("@kobalte/tailwindcss")],
  theme: {
    extend: {
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      colors: {
        // Design System: Slate base + Blue primary
        brand: {
          100: "#dbeafe", // blue-100
          200: "#bfdbfe", // blue-200
          300: "#93c5fd", // blue-300
          400: "#60a5fa", // blue-400
          50: "#eff6ff", // blue-50
          500: "#3b82f6", // blue-500 (primary)
          600: "#2563eb", // blue-600
          700: "#1d4ed8", // blue-700
          800: "#1e40af", // blue-800
          900: "#1e3a8a", // blue-900
        },
        // Semantic status colors
        status: {
          error: "#ef4444", // red-500
          info: "#3b82f6", // blue-500
          success: "#10b981", // emerald-500
          warning: "#f59e0b", // amber-500
        },
      },
    },
  },
};
