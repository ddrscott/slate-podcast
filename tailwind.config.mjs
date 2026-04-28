/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        signal: {
          DEFAULT: '#FF6A2A',
          50: '#FFF0E8',
          100: '#FFDFCC',
          200: '#FFBE99',
          500: '#FF6A2A',
          600: '#E5571A',
          700: '#B84413',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        slate: {
          'primary': '#FF6A2A',
          'primary-content': '#ffffff',
          'secondary': '#1f2937',
          'accent': '#0ea5e9',
          'neutral': '#0f172a',
          'base-100': '#ffffff',
          'base-200': '#f8fafc',
          'base-300': '#e2e8f0',
          'info': '#3b82f6',
          'success': '#10b981',
          'warning': '#f59e0b',
          'error': '#ef4444',
        },
      },
      'dark',
    ],
  },
};
