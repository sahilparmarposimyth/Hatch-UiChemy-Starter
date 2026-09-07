/**
 * Tailwind config for the Composer React panel (shadcn/ui token layer).
 *
 * Why this file is REQUIRED (and why its absence broke the panel):
 * `postcss.config.js` runs the `tailwindcss` plugin, which loads THIS file.
 * Without it Tailwind falls back to an empty `content`, so its JIT generates
 * NO utilities and tree-shakes the `@layer base { .uich-tw { --input … } }`
 * token block out of `shadcn.css`. The result is a build with bare preflight
 * only — every `flex / h-8 / border / border-input / bg-background /
 * text-foreground` class in the JSX becomes a no-op and the shadcn design
 * tokens resolve to empty, so inputs/selects lose their borders, backgrounds
 * and colors (the "panel looks broken / different from Elementor" report).
 *
 * The color tokens below map Tailwind color utilities to the CSS variables
 * declared on `.uich-tw` in `src/shadcn.css` (scoped there, not `:root`, so the
 * theme travels with the composer host without touching the builder document).
 * darkMode:'class' matches the `.dark` class toggled on that same host.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: 'class',
  // Scope every utility under `.uich-tw` (specificity 0,2,0) instead of using
  // literal !important. This is the fix for WordPress admin's forms.css (loaded
  // by load-styles.php in the Gutenberg editor), whose bare attribute selectors
  // — `input[type=text], select, textarea { border:…; min-height:40px; padding:… }`
  // (specificity 0,1,1) — otherwise outrank Tailwind's single-class utilities
  // (0,1,0) and leak a grey border, 40px height and stray padding onto the
  // composer's shadcn inputs. Raising utilities to 0,2,0 lets the panel's own
  // styling win. composer.css targets semantic classes / ids only (no Tailwind
  // utility selectors), so this does not disturb the legacy panel chrome.
  important: '.uich-tw',
  corePlugins: {
    // Tailwind emits `.container` WITHOUT the important-selector prefix, so it is
    // the one utility that escapes the `.uich-tw` island. Harmless while the
    // stylesheet only ever loaded into our own panel — but canvas.css loads into
    // the USER'S PAGE, and `.container` is one of the most common class names on
    // the web (every Bootstrap-derived theme has one). It would silently reset
    // their layout's width. Nothing in this codebase uses the utility, so the
    // plugin is off rather than special-cased.
    container: false,
  },
  content: [
    './src/uichemy-composer/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic construct-marker colors (used raw via hsl(var(--status-*))
        // in composer.css, exposed here too for any Tailwind consumers).
        status: {
          data: 'hsl(var(--status-data))',
          loop: 'hsl(var(--status-loop))',
          condition: 'hsl(var(--status-condition))',
          form: 'hsl(var(--status-form))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
