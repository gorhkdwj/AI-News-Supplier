import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // .remember는 로컬 세션 메모리 도구의 산출물(저장소 코드 아님)
    ignores: ['dist/**', 'node_modules/**', 'out/**', 'coverage/**', '.remember/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // 코어/수집기는 통로(cli, mcp)에 의존하지 않는다. (CLAUDE.md 3절)
    files: ['src/core/**/*.ts', 'src/collectors/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/cli/**', '**/mcp/**'],
              message:
                'core/collectors는 cli/mcp를 import할 수 없습니다 (통로 의존 금지, CLAUDE.md 3절).',
            },
          ],
        },
      ],
    },
  },
);
