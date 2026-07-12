import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // 객체 entry로 출력 경로를 고정한다(dist/cli/index.js, dist/mcp/server.js 등 bin 경로와 일치).
  entry: {
    'cli/index': 'src/cli/index.ts',
    'mcp/server': 'src/mcp/server.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  // 네이티브 모듈은 번들에서 제외한다(런타임에 node_modules에서 로드).
  external: ['better-sqlite3'],
  // 두 bin(ains, ains-mcp) 모두 실행 파일이므로 shebang을 붙인다.
  banner: { js: '#!/usr/bin/env node' },
  // 버전은 package.json을 단일 진실 원천으로 삼아 번들에 주입한다.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
