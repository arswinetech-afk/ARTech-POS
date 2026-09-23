/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecf8f0', 100: '#d3efdc', 200: '#a9dfbb', 300: '#74c994',
          400: '#3fae6c', 500: '#1f934f', 600: '#0f7a3f', 700: '#0b6132',
          800: '#0a4d29', 900: '#083f23',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)',
        pop: '0 12px 32px -8px rgba(16,24,40,.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'pulse-soft': { '0%,100%': { opacity: 1 }, '50%': { opacity: .45 } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        rise: { from: { opacity: 0, transform: 'translateY(14px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
        drift: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(24px,-18px) scale(1.08)' } },
        pop: { '0%': { transform: 'scale(1)' }, '35%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)' } },
        'flash-in': { from: { opacity: 0, transform: 'translateX(-8px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        pop: 'pop .28s cubic-bezier(.2,.8,.2,1)',
        'flash-in': 'flash-in .2s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
        'pulse-soft': 'pulse-soft 1.4s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        rise: 'rise .55s cubic-bezier(.2,.8,.2,1) both',
        drift: 'drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
