import { describe, expect, it } from 'vitest';

import { parseArguments } from './index.js';

describe('parseArguments', () => {
  it('uses the configured endpoint and JSON output flag', () => {
    expect(parseArguments(['artifact.zip', '--url', 'https://locker.example/', '--json'])).toEqual({
      baseUrl: 'https://locker.example',
      filePath: 'artifact.zip',
      json: true,
    });
  });

  it('rejects an absent file argument', () => {
    expect(() => parseArguments([])).toThrow('Usage: free-locker');
  });
});
