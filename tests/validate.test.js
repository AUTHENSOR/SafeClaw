import { describe, it, expect } from 'vitest';
import { assertString, assertIn, safeRegex, redactSecrets } from '../src/validate.js';

// --- assertString ---

describe('assertString', () => {
  it('passes for valid string', () => {
    expect(() => assertString('hello', 'field')).not.toThrow();
  });

  it('throws for non-string', () => {
    expect(() => assertString(123, 'field')).toThrow('field must be a string');
    expect(() => assertString(null, 'field')).toThrow('field must be a string');
    expect(() => assertString(undefined, 'field')).toThrow('field must be a string');
  });

  it('throws for string exceeding maxLen', () => {
    expect(() => assertString('a'.repeat(101), 'field', 100)).toThrow('at most 100');
  });

  it('passes for string at exactly maxLen', () => {
    expect(() => assertString('a'.repeat(100), 'field', 100)).not.toThrow();
  });

  it('uses default maxLen of 1000', () => {
    expect(() => assertString('a'.repeat(1000), 'field')).not.toThrow();
    expect(() => assertString('a'.repeat(1001), 'field')).toThrow('at most 1000');
  });
});

// --- assertIn ---

describe('assertIn', () => {
  it('passes for allowed value', () => {
    expect(() => assertIn('claude', 'provider', ['claude', 'openai'])).not.toThrow();
  });

  it('throws for disallowed value', () => {
    expect(() => assertIn('llama', 'provider', ['claude', 'openai'])).toThrow('must be one of');
  });

  it('includes allowed values in error message', () => {
    expect(() => assertIn('bad', 'x', ['a', 'b'])).toThrow('a, b');
  });
});

// --- safeRegex ---

describe('safeRegex', () => {
  it('accepts simple valid patterns', () => {
    const result = safeRegex('^hello$');
    expect(result.valid).toBe(true);
    expect(result.regex).toBeInstanceOf(RegExp);
    expect(result.error).toBeNull();
  });

  it('accepts character class patterns', () => {
    const result = safeRegex('[A-Za-z0-9]+');
    expect(result.valid).toBe(true);
  });

  it('accepts anchored patterns', () => {
    const result = safeRegex('^safe\\.read');
    expect(result.valid).toBe(true);
    expect(result.regex.test('safe.read.file')).toBe(true);
  });

  it('rejects invalid regex syntax', () => {
    const result = safeRegex('[invalid');
    expect(result.valid).toBe(false);
    expect(result.regex).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects non-string input', () => {
    const result = safeRegex(123);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Pattern must be a string');
  });

  it('rejects catastrophic backtracking pattern (a+)+', () => {
    const result = safeRegex('(a+)+b');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('nested quantifiers');
  });

  it('rejects (a*)*', () => {
    expect(safeRegex('(a*)*').valid).toBe(false);
  });

  it('rejects (?:a+)+', () => {
    expect(safeRegex('(?:a+)+').valid).toBe(false);
  });

  it('rejects (a|b+)+', () => {
    expect(safeRegex('(a|b+)+').valid).toBe(false);
  });

  it('handles empty string pattern', () => {
    const result = safeRegex('');
    expect(result.valid).toBe(true);
    expect(result.regex).toBeInstanceOf(RegExp);
  });

  it('regex returned actually works for matching', () => {
    const result = safeRegex('\\d{3}-\\d{4}');
    expect(result.valid).toBe(true);
    expect(result.regex.test('555-1234')).toBe(true);
    expect(result.regex.test('abc')).toBe(false);
  });
});

// --- redactSecrets ---

describe('redactSecrets', () => {
  it('redacts Anthropic API keys', () => {
    const text = 'My key is sk-ant-api03-abcdefghij1234567890';
    expect(redactSecrets(text)).toBe('My key is sk-ant-[REDACTED]');
    expect(redactSecrets(text)).not.toContain('abcdefghij');
  });

  it('redacts OpenAI API keys', () => {
    const text = 'Key: sk-proj-abcdefghij1234567890abcd';
    expect(redactSecrets(text)).toBe('Key: sk-[REDACTED]');
    expect(redactSecrets(text)).not.toContain('abcdefghij');
  });

  it('does not redact short sk- strings', () => {
    const text = 'The sk-short string stays';
    expect(redactSecrets(text)).toBe('The sk-short string stays');
  });

  it('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer sk-ant-api03-longtoken123456';
    const result = redactSecrets(text);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('longtoken');
  });

  it('redacts ANTHROPIC_API_KEY assignments', () => {
    const text = 'export ANTHROPIC_API_KEY=sk-ant-api03-secret123';
    const result = redactSecrets(text);
    expect(result).toContain('ANTHROPIC_API_KEY=[REDACTED]');
    expect(result).not.toContain('secret123');
  });

  it('redacts OPENAI_API_KEY assignments', () => {
    const text = 'OPENAI_API_KEY=sk-proj-abcdefghij1234567890abcd';
    const result = redactSecrets(text);
    expect(result).toContain('OPENAI_API_KEY=[REDACTED]');
  });

  it('redacts TWILIO_AUTH_TOKEN assignments', () => {
    const text = 'TWILIO_AUTH_TOKEN=abc123secrettoken456';
    const result = redactSecrets(text);
    expect(result).toContain('TWILIO_AUTH_TOKEN=[REDACTED]');
  });

  it('redacts multiple secrets in one string', () => {
    const text = 'Keys: sk-ant-api03-first1234567890 and sk-proj-second1234567890abcdefgh';
    const result = redactSecrets(text);
    expect(result).not.toContain('first');
    expect(result).not.toContain('second');
    expect(result).toContain('sk-ant-[REDACTED]');
    expect(result).toContain('sk-[REDACTED]');
  });

  it('passes through normal text unchanged', () => {
    const text = 'This is a normal log message about filesystem.write to /tmp/file.txt';
    expect(redactSecrets(text)).toBe(text);
  });

  it('handles non-string input gracefully', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(123)).toBe(123);
  });

  it('handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });
});
