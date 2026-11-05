import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
  ...tseslint.configs.recommended,
);
