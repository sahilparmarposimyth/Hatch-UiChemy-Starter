/**
 * Tailwind runs for the whole build, but only injects where `@tailwind`
 * directives appear — and those live solely in src/uichemy-composer/shadcn.css.
 * The dashboard's own SCSS passes through untouched (autoprefixer aside), so the
 * composer's reset can never leak into it.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
