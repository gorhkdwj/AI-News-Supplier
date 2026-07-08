import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, itemId } from '../../src/core/normalize.js';

describe('canonicalizeUrl', () => {
  it('utm_ 및 추적 파라미터를 제거한다', () => {
    expect(canonicalizeUrl('https://ex.com/p?utm_source=x&a=1&fbclid=z')).toBe('https://ex.com/p?a=1');
  });

  it('해시와 끝 슬래시를 제거하고 호스트를 소문자화한다', () => {
    expect(canonicalizeUrl('https://Ex.COM/path/#section')).toBe('https://ex.com/path');
  });

  it('루트 경로의 슬래시는 유지한다', () => {
    expect(canonicalizeUrl('https://ex.com/')).toBe('https://ex.com/');
  });

  it('파싱 불가 문자열은 trim만 한다', () => {
    expect(canonicalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('itemId', () => {
  it('동일 canonical URL은 동일 id를 낸다', () => {
    expect(itemId('https://ex.com/p')).toBe(itemId('https://ex.com/p'));
  });

  it('16자 hex id를 낸다', () => {
    expect(itemId('https://ex.com/p')).toMatch(/^[0-9a-f]{16}$/);
  });
});
