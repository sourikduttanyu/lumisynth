const browserGlobals = {
  Blob: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  DataView: 'readonly',
  File: 'readonly',
  Image: 'readonly',
  ImageData: 'readonly',
  MediaRecorder: 'readonly',
  ResizeObserver: 'readonly',
  URL: 'readonly',
  Uint8Array: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  window: 'readonly',
};

const workerGlobals = {
  Blob: 'readonly',
  DataView: 'readonly',
  Response: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  Uint8Array: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['src/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      }],
      'no-constant-binary-expression': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['playwright.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: workerGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-constant-binary-expression': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
