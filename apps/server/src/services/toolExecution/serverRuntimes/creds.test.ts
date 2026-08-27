import { describe, expect, it } from 'vitest';

import { formatSandboxCredentials } from './creds';

describe('formatSandboxCredentials', () => {
  it('emits sourceable, deterministic environment assignments', () => {
    expect(
      formatSandboxCredentials({ APIFY_TOKEN: "token'with-quote", 'INVALID-KEY': 'skip-me' }),
    ).toBe("export APIFY_TOKEN='token'\\''with-quote'");
  });
});
