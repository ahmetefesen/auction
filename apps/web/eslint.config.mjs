import base from "@auction/config/eslint";

export default [
  ...base,
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "postcss.config.js",
      "tailwind.config.ts",
      "next.config.mjs",
    ],
  },
];
