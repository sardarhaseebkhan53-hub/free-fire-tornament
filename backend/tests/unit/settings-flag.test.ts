// Boolean settings have arrived as true / "true" / 1 depending on seed vs admin edit.
import { describe, expect, it } from 'vitest';
import { settingEnabled } from '../../src/services/settings.service';

describe('settingEnabled', () => {
  it('treats true / "true" / 1 as on', () => {
    expect(settingEnabled(true)).toBe(true);
    expect(settingEnabled('true')).toBe(true);
    expect(settingEnabled(1)).toBe(true);
    expect(settingEnabled('1')).toBe(true);
  });

  it('treats false / "false" / 0 as off', () => {
    expect(settingEnabled(false)).toBe(false);
    expect(settingEnabled('false')).toBe(false);
    expect(settingEnabled(0)).toBe(false);
    expect(settingEnabled('0')).toBe(false);
  });

  it('falls back when the value is missing', () => {
    expect(settingEnabled(null, true)).toBe(true);
    expect(settingEnabled(undefined, false)).toBe(false);
  });
});
