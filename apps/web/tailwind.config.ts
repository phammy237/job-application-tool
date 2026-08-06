import type { Config } from 'tailwindcss';
import uiPreset from '@career-os/ui/tailwind-preset';

const config: Config = {
  presets: [uiPreset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
