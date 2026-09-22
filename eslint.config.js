import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'coverage/**', '**/dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'scripts/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['scripts/rebuild-ts6-phase-b-*.mjs', 'scripts/ts6-phase-b-c2-*.mjs'],
    rules: {
      'no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['adapters/frontend-sources-write-postgres/src/product-service.ts'],
    rules: {
      // These two imported contracts are retained as explicit Stage 2/URL persistence
      // compatibility witnesses while the Product service owns the activated orchestration.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^(CreateSourcesIntakeSubmissionInput|SourcesUrlSuccessProvenance)$',
        },
      ],
    },
  },
  {
    files: ['assemblies/shotgun-app/src/server.ts'],
    rules: {
      // The default in-memory coordinator is retained only as an explicit local/test
      // compatibility witness. Production and browser fixtures inject their coordinator.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^askCommandCoordinator$' },
      ],
    },
  },
);
