import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind preset: the Career OS visual identity (docs/PRODUCT_SPEC.md "Design
 * direction" — purple accent connecting to mypham.space, clean neutral surfaces, rounded but
 * not playful). Colors are HSL CSS variables so apps/web can flip light/dark without
 * shipping two palettes; the variable values themselves live in apps/web/app/globals.css.
 *
 * Each entry uses the `<alpha-value>` placeholder so Tailwind opacity modifiers
 * (e.g. `bg-status-offer/15`) work correctly — see
 * https://tailwindcss.com/docs/customizing-colors#using-css-variables.
 */
function hslVar(name: string): string {
  return `hsl(var(${name}) / <alpha-value>)`;
}

const preset: Pick<Config, 'darkMode' | 'theme'> = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        border: hslVar('--border'),
        input: hslVar('--input'),
        ring: hslVar('--ring'),
        background: hslVar('--background'),
        foreground: hslVar('--foreground'),
        primary: {
          DEFAULT: hslVar('--primary'),
          foreground: hslVar('--primary-foreground'),
        },
        secondary: {
          DEFAULT: hslVar('--secondary'),
          foreground: hslVar('--secondary-foreground'),
        },
        muted: {
          DEFAULT: hslVar('--muted'),
          foreground: hslVar('--muted-foreground'),
        },
        accent: {
          DEFAULT: hslVar('--accent'),
          foreground: hslVar('--accent-foreground'),
        },
        destructive: {
          DEFAULT: hslVar('--destructive'),
          foreground: hslVar('--destructive-foreground'),
        },
        card: {
          DEFAULT: hslVar('--card'),
          foreground: hslVar('--card-foreground'),
        },
        // Application-status colors — docs/PRODUCT_SPEC.md §7, kept distinct from the
        // primary purple accent so status is scannable at a glance in the tracker.
        status: {
          saved: hslVar('--status-saved'),
          progress: hslVar('--status-progress'),
          applied: hslVar('--status-applied'),
          received: hslVar('--status-received'),
          assessment: hslVar('--status-assessment'),
          interview: hslVar('--status-interview'),
          action: hslVar('--status-action'),
          offer: hslVar('--status-offer'),
          rejected: hslVar('--status-rejected'),
          withdrawn: hslVar('--status-withdrawn'),
          unknown: hslVar('--status-unknown'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
};

export default preset;
