import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // The domain core is pure TypeScript.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                'kysely',
                'kysely/*',
                'pg',
                'pg-*',
                '@opentelemetry/*',
                'pino',
                'nestjs-pino',
                'class-validator',
                'class-transformer',
              ],
              message: 'src/domain must not depend on frameworks or I/O.',
            },
            {
              group: ['@/*', '!@/domain', '!@/domain/*'],
              message: 'src/domain may only import from src/domain.',
            },
            {
              regex:
                '^\\.\\.?/(\\.\\./)*(common|persistence|booking|availability|reference-data|telemetry|health)(/|$)',
              message: 'src/domain may only import from src/domain.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
