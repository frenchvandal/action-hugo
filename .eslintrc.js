module.exports = {
  env: {
    node: true,
    es2020: true,
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  ignorePatterns: ['.eslintrc.js', 'lib', 'dist', 'node_modules'],
  rules: {
    'prettier/prettier': [
      'error',
      {
        endOfLine: 'auto',
        'comma-dangle': ['error', 'always-multiline'],
        curly: ['error', 'multi-or-nest'],
      },
    ],
  },
};
