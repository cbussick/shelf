import cloudflare from '@cloudflare/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  ...cloudflare,
  options: { ...cloudflare.options, typeAware: true, typeCheck: true },
  ignorePatterns: [
    ...(cloudflare.ignorePatterns ?? []),
    'dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**',
  ],
  rules: {
    ...cloudflare.rules,
    // Retain PR93 correctness checks absent from the shared preset.
    'no-caller': 'error',
    'no-iterator': 'error',
    'no-unassigned-vars': 'error',
    'oxc/bad-array-method-on-arguments': 'error',
    'oxc/bad-match-all-arg': 'error',
    'oxc/erasing-op': 'error',
    'oxc/only-used-in-recursion': 'error',
    'typescript/no-base-to-string': 'error',
    'typescript/no-implied-eval': 'error',
    'typescript/no-meaningless-void-operator': 'error',
    'typescript/no-redundant-type-constituents': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-useless-default-assignment': 'error',
    'typescript/no-useless-empty-export': 'error',
    'typescript/restrict-template-expressions': 'error',
    'unicorn/no-await-in-promise-methods': 'error',
    'unicorn/no-empty-file': 'error',
    'unicorn/no-new-array': 'error',
    'unicorn/no-single-promise-in-promise-methods': 'error',
    'unicorn/no-thenable': 'error',
    'unicorn/no-unnecessary-await': 'error',
    'unicorn/no-useless-fallback-in-spread': 'error',
    'unicorn/no-useless-length-check': 'error',
    'unicorn/prefer-string-starts-ends-with': 'error',
    // Preserve PR93's strict promise options, including mixed await arrays.
    'typescript/await-thenable': 'error',
    'typescript/no-misused-promises': 'error',
  },
  overrides: [
    ...(cloudflare.overrides ?? []),
    // Preserve PR93 checks that the preset delegates to tsc, plus test method safety.
    { files: ['**/*.{ts,tsx,mts,cts}'], rules: {
      'constructor-super': 'error',
      'getter-return': 'error',
      'no-class-assign': 'error',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-keys': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-new-native-nonconstructor': 'error',
      'no-obj-calls': 'error',
      'no-setter-return': 'error',
      'no-this-before-super': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-with': 'error',
      'typescript/unbound-method': 'error',
    } },
  ],
});
