import { ESLint } from 'eslint';
import parser from '@typescript-eslint/parser';
import hooks from 'eslint-plugin-react-hooks';

// Focused release gate: runtime hook ordering must pass even while the
// repository's unrelated legacy lint warnings are being addressed.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  }],
});
const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) console.log(output);
const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
if (errors) process.exitCode = 1;
else console.log(`Orden de hooks verificado en ${results.length} archivos.`);
