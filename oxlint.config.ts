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
    // Temporary migration disables; evaluate each in its own commit.
    // Existing compact guards/loops are intentional; a brace-only rewrite adds noise.
    { files: ['**/*'], rules: { 'curly': 'off' } },
    // Both T[] and Array<T> are readable; do not rewrite 117 existing annotations.
    { files: ['**/*'], rules: { 'typescript/array-type': 'off' } },
    // Trusted SQLite/Multer rows, DOM targets, IDB records and test fault injection.
    // Keep runtime/schema validation; replacing these assertions is a separate boundary audit.
    { files: [
      'src/server/{app,auth,database,note-uploads}.ts',
      'src/client/components/{AddAudio,Editor,NoteBoard,NoteContextMenu,NoteReading,RichTextEditor}.tsx',
      'src/client/{incoming-share,local-store,note-preparation,sw}.ts', 'tests/**/*.ts',
    ], rules: { 'typescript/no-unsafe-type-assertion': 'off' } },
    // Inline `type` specifiers are already explicit and avoid splitting mixed imports.
    { files: ['**/*'], rules: { 'import/consistent-type-specifier-style': 'off' } },
    // Established schema keys, mounted refs, nonempty caches and checked IDB identities.
    // Do not substitute optional chaining that would silently skip required work.
    { files: [
      'src/client/components/{NoteReading,AudioPlayer,RichTextEditor,NoteBoard}.tsx',
      'src/client/{prepared-documents,note-preparation,rich-text,local-store,main}.ts*',
    ], rules: { 'typescript/no-non-null-assertion': 'off' } },
    // Imperative editor/recorder callbacks and retained checkpoint state intentionally use refs.
    // These components are not React-Compiler optimized; preserve tested save/lifecycle ordering.
    { files: ['src/client/App.tsx', 'src/client/components/{AudioPlayer,AudioRecorder,RichTextEditor,Editor}.tsx'], rules: { 'react/refs': 'off' } },
    // Schema/DOM assertions record invariants even when inferred programs omit nullability.
    { files: ['src/client/rich-text.ts', 'tests/e2e/{app,audio-conflicts,loading,local-store-autosave,ready-note-dialog,rich-text-safety,rich-text}.spec.ts'], rules: { 'typescript/no-unnecessary-type-assertion': 'off' } },
    // Untyped request.json()/IDB test fixtures exercise malformed payloads, not app boundaries.
    { files: ['tests/e2e/{audio-conflicts,audio,autosave-conflicts,board-previews,image-rotation,video}.spec.ts', 'tests/unit/{api,video}.test.ts'], rules: { 'typescript/no-unsafe-call': 'off' } },
    // Test-only window hooks/readonly viewport overrides and the worker's dual DOM lib bridge.
    { files: ['src/client/sw.ts', 'tests/e2e/{diagnostics-cleanup,mobile-editor-keyboard,note-save-recovery,note-context-color,async-callbacks,note-autosave,sync-errors,audio}.spec.ts'], rules: { 'quality/no-chained-type-assertions': 'off' } },
    // StyleX's compiler recognizes its documented namespace import; retain other namespace checks.
    { files: ['**/*'], rules: { 'import/no-namespace': ['error', { ignore: ['@stylexjs/stylex'] }] } },
    // Same-realm DOM/File guards and trusted error subclasses must not become duck typing.
    { files: ['src/client/{App.tsx,sw.ts}', 'src/client/components/{RichTextEditor,Editor}.tsx', 'src/server/{app,logging}.ts', 'tests/e2e/{audio-error-layout,note-autosave}.spec.ts'], rules: { '@nkzw/no-instanceof': 'off' } },
    // IDB reads are parsed after retrieval; ProseMirror attrs and Express route metadata are untyped.
    // Do not invent a typed storage schema that pretends persisted bytes have been validated.
    { files: ['src/client/{local-store,rich-text}.ts', 'src/server/logging.ts'], rules: { 'typescript/no-unsafe-assignment': 'off' } },
    { files: ['**/*'], rules: { 'typescript/no-unsafe-return': 'off' } },
    { files: ['**/*'], rules: { 'quality/no-known-value-widening': 'off' } },
    { files: ['**/*'], rules: { 'unicorn/catch-error-name': 'off' } },
    { files: ['**/*'], rules: { 'quality/no-conditional-empty-object-spread': 'off' } },
    { files: ['**/*'], rules: { 'typescript/consistent-type-imports': 'off' } },
    { files: ['**/*'], rules: { 'no-promise-executor-return': 'off' } },
    { files: ['**/*'], rules: { 'quality/no-unsafe-dictionary-type': 'off' } },
    { files: ['**/*'], rules: { 'eqeqeq': 'off' } },
    { files: ['**/*'], rules: { 'react/set-state-in-effect': 'off' } },
    { files: ['**/*'], rules: { 'unicorn/consistent-function-scoping': 'off' } },
    { files: ['**/*'], rules: { 'react/rules-of-hooks': 'off' } },
    { files: ['**/*'], rules: { 'typescript/no-unsafe-member-access': 'off' } },
    { files: ['**/*'], rules: { 'typescript/use-unknown-in-catch-callback-variable': 'off' } },
    { files: ['**/*'], rules: { 'unicorn/numeric-separators-style': 'off' } },
    { files: ['**/*'], rules: { 'typescript/no-unsafe-argument': 'off' } },
    { files: ['**/*'], rules: { 'react/exhaustive-deps': 'off' } },
    { files: ['**/*'], rules: { 'typescript/no-import-type-side-effects': 'off' } },
    { files: ['**/*'], rules: { 'no-console': 'off' } },
    { files: ['**/*'], rules: { 'react/immutability': 'off' } },
    { files: ['**/*'], rules: { 'react/button-has-type': 'off' } },
    { files: ['**/*'], rules: { 'quality/no-unknown-returns': 'off' } },
    { files: ['**/*'], rules: { 'unicorn/prefer-number-properties': 'off' } },
    { files: ['**/*'], rules: { '@nkzw/require-use-effect-arguments': 'off' } },
  ],
});
