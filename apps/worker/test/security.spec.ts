import { describe, expect, it } from 'vitest';

import { contentDisposition, sanitizeFilename } from '../src/security';

describe('upload security helpers', () => {
  it('normalizes dangerous filename input to a safe display name', () => {
    expect(sanitizeFilename('../../private\u0000.txt')).toBe('.._.._private.txt');
    expect(sanitizeFilename('\\')).toBe('_');
    expect(sanitizeFilename('...')).toBe('upload.bin');
  });

  it('emits an attachment disposition without unsafe quote characters', () => {
    const header = contentDisposition('report "final".txt');
    expect(header).toContain('attachment');
    expect(header).toContain('filename*=UTF-8');
    expect(header).not.toContain('filename="report "final"');
  });
});
