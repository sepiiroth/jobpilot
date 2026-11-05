import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'] },
  ...tseslint.configs.recommended,
);
