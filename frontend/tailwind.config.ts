import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        spotzy: {
          primary:  '#006B3C',
          forest:   '#004526',
          brick:    '#AD3614',
          'brick-light': '#F5E6E1',
          'brick-mid': '#C94A28',
          'brick-border': '#D4826A',
          ink:      '#1C2B1A',
          sage:     '#EBF7F1',
          mint:     '#B8E6D0',
          mist:     '#EFF5F1',
          park:     '#059669',
          slate:    '#4B6354',
          concrete: '#B0BEC5',
          cloud:    '#F0F7F3',
          // Visual rehaul — premium dark brand
          'forest-deep': '#0B2418',
          'forest-card': '#0F2E1F',
          sun:      '#F4C73B',
          'sun-deep': '#E5B520',
          paper:    '#F7F5EE',
          'ink-on-sun': '#0B2418',
          // Legacy aliases
          navy:     '#004526',
          amber:    '#AD3614',
          green:    '#006B3C',
          red:      '#C0392B',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        head:    ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['DM Sans', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'display': ['2.5rem', { lineHeight: '1.1', fontWeight: '700' }],
        'h1':      ['1.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'h2':      ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        'h3':      ['1rem', { lineHeight: '1.4', fontWeight: '600' }],
        'body':    ['0.9375rem', { lineHeight: '1.6', fontWeight: '400' }],
        'caption': ['0.8125rem', { lineHeight: '1.4', fontWeight: '400' }],
        'price':   ['1.25rem', { lineHeight: '1.2', fontWeight: '700' }],
        'price-lg':['2rem', { lineHeight: '1.2', fontWeight: '700' }],
        'btn':     ['0.875rem', { lineHeight: '1.4', fontWeight: '600' }],
        'code':    ['0.8125rem', { lineHeight: '1.5', fontWeight: '400' }],
      },
      spacing: {
        'sp-1': '4px',
        'sp-2': '8px',
        'sp-3': '12px',
        'sp-4': '16px',
        'sp-5': '20px',
        'sp-6': '24px',
        'sp-7': '32px',
        'sp-8': '48px',
      },
      borderRadius: {
        'sm-spotzy': '6px',
        'md-spotzy': '8px',
        'lg-spotzy': '12px',
        'xl-spotzy': '16px',
      },
      boxShadow: {
        'sm-spotzy': '0 1px 2px rgba(0, 69, 38, 0.06)',
        'md-spotzy': '0 4px 12px rgba(0, 69, 38, 0.10)',
        'lg-spotzy': '0 8px 24px rgba(0, 69, 38, 0.14)',
        'forest': '0 4px 12px rgba(0, 69, 38, 0.18)',
        'brick': '0 4px 12px rgba(173, 54, 20, 0.18)',
      },
      keyframes: {
        'page-enter': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-soft': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'page-enter': 'page-enter 600ms ease-out',
        'fade-in-soft': 'fade-in-soft 600ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
