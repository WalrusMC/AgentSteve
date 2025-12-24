const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    env: {
      node: true,
      es2024: true,
    },

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },

    rules: {
      // 🧠 Correctness / Safety
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-implicit-globals': 'error',
      'require-await': 'error',
      'no-return-await': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // 🎨 Style (your original rules)
      'arrow-spacing': ['warn', { before: true, after: true }],
      'brace-style': ['error', 'stroustrup', { allowSingleLine: true }],
      'comma-dangle': ['error', 'always-multiline'],
      'comma-spacing': 'error',
      'comma-style': 'error',
      curly: ['error', 'multi-line', 'consistent'],
      'dot-location': ['error', 'property'],
      'handle-callback-err': 'off',
      'keyword-spacing': 'error',
      'max-nested-callbacks': ['error', { max: 4 }],
      'max-statements-per-line': ['error', { max: 2 }],
      'no-console': 'off',
      'no-empty-function': 'error',
      'no-floating-decimal': 'error',
      'no-lonely-if': 'error',
      'no-multi-spaces': 'error',
      'no-multiple-empty-lines': [
        'error',
        { max: 2, maxEOF: 1, maxBOF: 0 },
      ],
      'no-shadow': ['error', { allow: ['err', 'resolve', 'reject'] }],
      'no-trailing-spaces': 'error',
      'object-curly-spacing': ['error', 'always'],
      semi: ['error', 'always'],
      'space-before-blocks': 'error',
      'space-before-function-paren': [
        'error',
        {
          anonymous: 'never',
          named: 'never',
          asyncArrow: 'always',
        },
      ],
      'space-in-parens': 'error',
      'space-infix-ops': 'error',
      'space-unary-ops': 'error',
      'spaced-comment': 'error',
      yoda: 'error',
    },
  },
];
