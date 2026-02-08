/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#161b22',
          base: '#0d0f12',
          elevated: '#21262d',
          hover: '#1c2128',
        },
        border: {
          dark: '#30363d',
          muted: '#21262d',
        },
        content: {
          primary: '#e6edf3',
          secondary: '#8b949e',
          muted: '#6e7681',
        },
        accent: {
          DEFAULT: '#388bfd',
          hover: '#58a6ff',
          muted: '#1f6feb',
        },
      },
      spacing: {
        'page': '0.75rem',
        'card': '0.5rem',
      },
    },
  },
  plugins: [],
}