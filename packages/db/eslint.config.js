import base from "@auction/config/eslint";

export default [
  ...base,
  {
    files: ["prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
