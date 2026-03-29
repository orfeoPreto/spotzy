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
          navy:     '#004526',
          amber:    '#AD3614',
          green:    '#006B3C',
          red:      '#C0392B',
          concrete: '#B0BEC5',
          cloud:    '#F0F7F3',
          mist:     '#F0F7F3',
        },
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        head:  ['DM Sans', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
