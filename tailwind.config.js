/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#f6f7f9',
        ink: '#101827',
        accent: '#0f766e',
        warning: '#b45309',
        danger: '#b91c1c',
      },
    },
  },
  plugins: [],
};
