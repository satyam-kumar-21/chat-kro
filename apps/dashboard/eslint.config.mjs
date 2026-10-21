import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: [".next/**", "next-env.d.ts"]
  }
);
