import { describe, it, expect } from 'vitest';
import { defaultPolicyTemplate } from '../src/templates.js';

describe('defaultPolicyTemplate', () => {
  it('has required top-level fields', () => {
    expect(defaultPolicyTemplate.id).toBe('safeclaw-default');
    expect(defaultPolicyTemplate.version).toBeDefined();
    expect(defaultPolicyTemplate.name).toBeDefined();
    expect(defaultPolicyTemplate.defaultEffect).toBe('deny');
    expect(Array.isArray(defaultPolicyTemplate.rules)).toBe(true);
  });

  it('defaults to deny', () => {
    expect(defaultPolicyTemplate.defaultEffect).toBe('deny');
  });

  it('has 4 rules covering all action categories', () => {
    expect(defaultPolicyTemplate.rules.length).toBe(4);
  });

  it('each rule has required fields', () => {
    for (const rule of defaultPolicyTemplate.rules) {
      expect(rule.id).toBeDefined();
      expect(rule.effect).toBeDefined();
      expect(rule.description).toBeDefined();
      expect(rule.condition).toBeDefined();
      expect(rule.condition.any).toBeDefined();
      expect(Array.isArray(rule.condition.any)).toBe(true);
    }
  });

  it('first rule allows safe reads', () => {
    const readRule = defaultPolicyTemplate.rules[0];
    expect(readRule.effect).toBe('allow');
    expect(readRule.condition.any[0].value).toBe('safe.read');
  });

  it('write/code/network/mcp rules require approval', () => {
    const approvalRules = defaultPolicyTemplate.rules.filter(r => r.effect === 'require_approval');
    expect(approvalRules.length).toBe(3);
  });
});
