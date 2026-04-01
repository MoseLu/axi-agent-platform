/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f7ff',
          100: '#ebf0ff',
          200: '#d1dcff',
          300: '#b2c4ff',
          400: '#85a1ff',
          500: '#4165d7', // Cool-admin blue
          600: '#3451ac',
          700: '#273d81',
          800: '#1a2956',
          900: '#0d142b',
        },
        accent: {
          purple: '#7c4dff',
          pink: '#ff4081',
          cyan: '#00bcd4',
        },
        dark: {
          950: '#000000',
          900: '#15171a', // Cool-admin main bg
          800: '#1d1f23', // Cool-admin component bg
          700: '#2a2d33', // Cool-admin border/hover
          600: '#3a3f47',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99, 102, 241, 0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.8), 0 0 40px rgba(139, 92, 246, 0.4)' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
