/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CIC tactical console palette
        navy: '#070C14', // base canvas / radar void + recessed input bays
        panel: '#0E1726', // surfaces / panels / cards
        panelBorder: '#1E2E4A', // structural frames
        surfaceAlt: '#121C2F', // zebra striping / alt rows
        textPrimary: '#E6EDF7',
        textSecondary: '#8195AE',
        amberAccent: '#F59E0B', // critical action required (reposition)
        greenAccent: '#10B981', // system lock / in range
        skyAccent: '#38BDF8', // active kinetic / in flight
        slateTrack: '#64748B', // hold fire / wait
        redAccent: '#EF4444',
      },
      // Rigid military-hardware geometry: tighten every radius.
      borderRadius: {
        none: '0',
        sm: '1px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '4px',
        '2xl': '6px',
        full: '9999px',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
