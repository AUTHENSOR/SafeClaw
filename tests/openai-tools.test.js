import { describe, it, expect } from 'vitest';
import { TOOLS, toClassifierInput, globToRegex } from '../src/openai-agent.js';

describe('TOOLS', () => {
  it('has 6 tool definitions', () => {
    expect(TOOLS.length).toBe(6);
  });

  it('each tool has correct structure', () => {
    for (const tool of TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeDefined();
      expect(tool.function.description).toBeDefined();
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.required).toBeDefined();
    }
  });

  it('includes expected tool names', () => {
    const names = TOOLS.map(t => t.function.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('run_command');
    expect(names).toContain('list_files');
    expect(names).toContain('search_files');
  });
});

describe('toClassifierInput', () => {
  it('maps read_file to file_path', () => {
    const result = toClassifierInput('read_file', { path: '/tmp/foo.txt' });
    expect(result.file_path).toBe('/tmp/foo.txt');
  });

  it('maps write_file to file_path + content', () => {
    const result = toClassifierInput('write_file', { path: '/out.txt', content: 'hello' });
    expect(result.file_path).toBe('/out.txt');
    expect(result.content).toBe('hello');
  });

  it('maps edit_file to file_path + old_string + new_string', () => {
    const result = toClassifierInput('edit_file', { path: '/f', old_string: 'a', new_string: 'b' });
    expect(result.file_path).toBe('/f');
    expect(result.old_string).toBe('a');
    expect(result.new_string).toBe('b');
  });

  it('maps run_command to command', () => {
    const result = toClassifierInput('run_command', { command: 'ls -la' });
    expect(result.command).toBe('ls -la');
  });

  it('maps list_files to pattern + path', () => {
    const result = toClassifierInput('list_files', { pattern: '*.js', directory: '/src' });
    expect(result.pattern).toBe('*.js');
    expect(result.path).toBe('/src');
  });

  it('maps search_files to pattern + path', () => {
    const result = toClassifierInput('search_files', { pattern: 'TODO', directory: '/src' });
    expect(result.pattern).toBe('TODO');
    expect(result.path).toBe('/src');
  });

  it('returns args unchanged for unknown tools', () => {
    const args = { foo: 'bar' };
    const result = toClassifierInput('unknown_tool', args);
    expect(result).toBe(args);
  });
});

describe('globToRegex', () => {
  it('matches *.js files', () => {
    const re = globToRegex('*.js');
    expect(re.test('foo.js')).toBe(true);
    expect(re.test('bar.ts')).toBe(false);
    expect(re.test('src/foo.js')).toBe(false); // no ** so no slashes
  });

  it('matches **/*.ts with directory paths', () => {
    const re = globToRegex('**/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/deep/bar.ts')).toBe(true);
    expect(re.test('foo.ts')).toBe(false); // **/ requires at least one directory separator
    expect(re.test('foo.js')).toBe(false);
  });

  it('matches ? as single character wildcard', () => {
    const re = globToRegex('?.txt');
    expect(re.test('a.txt')).toBe(true);
    expect(re.test('ab.txt')).toBe(false);
  });

  it('handles literal dots', () => {
    const re = globToRegex('*.test.js');
    expect(re.test('foo.test.js')).toBe(true);
    expect(re.test('footestxjs')).toBe(false);
  });

  it('handles pattern with no wildcards', () => {
    const re = globToRegex('exact.txt');
    expect(re.test('exact.txt')).toBe(true);
    expect(re.test('other.txt')).toBe(false);
  });
});
