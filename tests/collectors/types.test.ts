import { expectTypeOf, it } from 'vitest';
import type { CollectorResult } from '../../src/collectors/types.js';
import type { LiveSightingInput } from '../../src/core/types.js';

it('CollectorResult items는 normalized live Sighting 계약이다', () => {
  expectTypeOf<CollectorResult['items'][number]>().toEqualTypeOf<LiveSightingInput>();
});
