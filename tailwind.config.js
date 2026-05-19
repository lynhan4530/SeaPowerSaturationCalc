/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0A0F1E',
        panel: '#111827',
        panelBorder: '#1F2937',
        textPrimary: '#F9FAFB',
        textSecondary: '#9CA3AF',
        amberAccent: '#F59E0B',
        redAccent: '#EF4444',
        greenAccent: '#10B981',
      },
    },
  },
  plugins: [],
};
