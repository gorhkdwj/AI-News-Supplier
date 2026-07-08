import { describe, it, expect } from 'vitest';

// S0 스캐폴드 검증용 최소 테스트. S1부터 실제 로직 테스트로 대체된다.
describe('smoke', () => {
  it('테스트 러너가 동작한다', () => {
    expect(1 + 1).toBe(2);
  });
});
