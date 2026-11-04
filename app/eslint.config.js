import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

// Filter out the @typescript-eslint plugin from nextVitals to avoid
// "Cannot redefine plugin" conflict with tseslint.configs.recommendedTypeChecked.
const nextVitalsFiltered = nextVitals.map((config) => {
  if (config.plugins?.["@typescript-eslint"]) {
    const { "@typescript-eslint": _, ...rest } = config.plugins;
    return { ...config, plugins: rest };
  }
  return config;
});

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "generated/**",
      ".yarn/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitalsFiltered,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
