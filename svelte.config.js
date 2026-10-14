import adapter from "@sveltejs/adapter-auto";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    // Short names for the backend engine, so pages never write long relative paths.
    alias: {
      $engine: "convex/engine",
      $config: "convex/config",
    },
  },
};

export default config;
