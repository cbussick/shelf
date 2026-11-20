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
    // Reviewed Shelf exceptions/options; rationale and migration inventory: docs/cloudflare-oxlint-audit.md.
    // Trusted SQLite/Multer rows, DOM targets, IDB records and test fault injection.
    // Keep runtime/schema validation; replacing these assertions is a separate boundary audit.
    { files: [
      'src/server/{app,auth,database,note-uploads}.ts',
      'src/client/components/{AddAudio,Editor,NoteBoard,NoteContextMenu,NoteReading,RichTextEditor}.tsx',
      'src/client/{incoming-share,local-store,note-preparation,sw}.ts', 'tests/**/*.ts',
    ], rules: { 'typescript/no-unsafe-type-assertion': 'off' } },
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
    // Test-only window hooks/readonly viewport overrides and the worker's dual DOM lib bridge.
    { files: ['src/client/sw.ts', 'tests/e2e/{diagnostics-cleanup,mobile-editor-keyboard,note-save-recovery,note-context-color,async-callbacks,note-autosave,sync-errors,audio}.spec.ts'], rules: { 'quality/no-chained-type-assertions': 'off' } },
    // Same-realm DOM/File guards and trusted error subclasses must not become duck typing.
    { files: ['src/client/{App.tsx,sw.ts}', 'src/client/components/{RichTextEditor,Editor}.tsx', 'src/server/{app,logging}.ts', 'tests/e2e/{audio-error-layout,note-autosave}.spec.ts'], rules: { '@nkzw/no-instanceof': 'off' } },
    // ProseMirror's toJSON() returns any; test API/IDB fixtures intentionally inspect raw payloads.
    { files: ['src/client/rich-text.ts', 'tests/e2e/{app,autosave-conflicts,image-rotation,video}.spec.ts'], rules: { 'typescript/no-unsafe-return': 'off' } },
    // Synchronize external audio/dialog/auth/sync lifecycles; moving these updates changes ordering.
    { files: ['src/client/App.tsx', 'src/client/components/{AudioPlayer,Editor}.tsx'], rules: { 'react/set-state-in-effect': 'off' } },
    // Browser evaluate() closures must serialize in place; memo callbacks and local test helpers belong here.
    { files: ['src/client/components/NoteBoard.tsx', 'tests/e2e/{local-store-autosave,sync-layout}.spec.ts', 'tests/unit/{video,api}.test.ts'], rules: { 'unicorn/consistent-function-scoping': 'off' } },
    // Playwright's fixture callback is named `use`, not React.use(). Keep real hook checks on.
    { files: ['tests/fixtures/isolated-test.ts', 'tests/e2e/audio.spec.ts'], rules: { 'react/rules-of-hooks': 'off' } },
    // CheckpointWriter is a mutable external controller: flush errors and subscriptions update it.
    // This is not mutation of React state; replacing its tested protocol is outside lint migration.
    { files: ['src/client/components/Editor.tsx'], rules: { 'react/immutability': 'off' } },
    // Both flagged buttons spread buttonProps, which already contains `type: 'button' as const`.
    { files: ['src/client/components/NoteBoard.tsx'], rules: { 'react/button-has-type': 'off' } },
    // IDB's get contract is deliberately unknown until parsed; Express ignores handler return values.
    // Neither adapter should claim unvalidated bytes are a domain value.
    { files: ['src/client/local-store.ts', 'src/server/note-uploads.ts'], rules: { 'quality/no-unknown-returns': 'off' } },
  ],
});
