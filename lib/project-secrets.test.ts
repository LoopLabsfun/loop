import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, secretsConfigured } from "./project-secrets";

// A throwaway 32-byte master key (hex) for the round-trip tests.
const TEST_KEY = "0".repeat(64);

describe("project-secrets crypto", () => {
  const prev = process.env.PROJECT_SECRETS_KEY;
  beforeEach(() => {
    process.env.PROJECT_SECRETS_KEY = TEST_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.PROJECT_SECRETS_KEY;
    else process.env.PROJECT_SECRETS_KEY = prev;
  });

  it("is armed only with a valid 32-byte key", () => {
    expect(secretsConfigured()).toBe(true);
    process.env.PROJECT_SECRETS_KEY = "";
    expect(secretsConfigured()).toBe(false);
    process.env.PROJECT_SECRETS_KEY = "tooshort";
    expect(secretsConfigured()).toBe(false);
  });

  it("round-trips a secret", () => {
    const plain = "sk-ant-test-1234567890";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain); // actually encrypted
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV) but decrypts the same", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("returns null on tamper", () => {
    const enc = encryptSecret("secret");
    const tampered = `${enc.slice(0, -4)}AAAA`;
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("returns null / throws when unconfigured", () => {
    const enc = encryptSecret("x");
    process.env.PROJECT_SECRETS_KEY = "";
    expect(secretsConfigured()).toBe(false);
    expect(decryptSecret(enc)).toBeNull(); // can't decrypt without the key
    expect(() => encryptSecret("y")).toThrow();
  });

  it("cannot decrypt with a different master key", () => {
    const enc = encryptSecret("secret");
    process.env.PROJECT_SECRETS_KEY = "f".repeat(64);
    expect(decryptSecret(enc)).toBeNull();
  });
});
