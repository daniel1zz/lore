// Tailwind v4 is wired via `@tailwindcss/vite` in vite.config.ts.
// PostCSS only handles vendor-prefix autoprefixer here.
export default {
  plugins: {
    autoprefixer: {},
  },
};
