import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 라이브 네트워크 테스트는 기본 실행에서 제외한다(수동 태그로만 실행).
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**/*.live.test.ts'],
  },
});
