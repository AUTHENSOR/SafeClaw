import { describe, it, expect } from 'vitest';
import { classify, isSafeRead, sanitize } from '../src/classifier.js';

describe('classify', () => {
  it('maps Read to safe.read.file with file_path as resource', () => {
    const result = classify('Read', { file_path: '/tmp/foo.txt' });
    expect(result.actionType).toBe('safe.read.file');
    expect(result.resource).toBe('/tmp/foo.txt');
  });

  it('maps Bash to code.exec with command as resource', () => {
    const result = classify('Bash', { command: 'ls -la' });
    expect(result.actionType).toBe('code.exec');
    expect(result.resource).toBe('ls -la');
  });

  it('maps Write to filesystem.write', () => {
    expect(classify('Write', { file_path: '/out.txt' }).actionType).toBe('filesystem.write');
  });

  it('maps Edit to filesystem.write', () => {
    expect(classify('Edit', { file_path: '/out.txt' }).actionType).toBe('filesystem.write');
  });

  it('maps Glob to safe.read.glob', () => {
    expect(classify('Glob', { pattern: '*.js' }).actionType).toBe('safe.read.glob');
  });

  it('maps Grep to safe.read.grep', () => {
    expect(classify('Grep', { pattern: 'TODO' }).actionType).toBe('safe.read.grep');
  });

  it('maps WebFetch to network.http', () => {
    expect(classify('WebFetch', { url: 'https://example.com' }).actionType).toBe('network.http');
  });

  it('maps WebSearch to network.search', () => {
    expect(classify('WebSearch', { query: 'test' }).actionType).toBe('network.search');
  });

  it('maps NotebookEdit to filesystem.write', () => {
    expect(classify('NotebookEdit', { notebook_path: '/nb.ipynb' }).actionType).toBe('filesystem.write');
  });

  it('maps TodoWrite to safe.read.meta', () => {
    expect(classify('TodoWrite', {}).actionType).toBe('safe.read.meta');
  });

  it('maps AskUserQuestion to safe.read.meta', () => {
    expect(classify('AskUserQuestion', {}).actionType).toBe('safe.read.meta');
  });

  it('maps Task to agent.subagent', () => {
    expect(classify('Task', { description: 'explore' }).actionType).toBe('agent.subagent');
  });

  it('maps TaskStop to code.exec.kill', () => {
    expect(classify('TaskStop', {}).actionType).toBe('code.exec.kill');
  });

  it('handles MCP tools with server and action', () => {
    const result = classify('mcp__myserver__doThing', { x: 1 });
    expect(result.actionType).toBe('mcp.myserver.doThing');
  });

  it('handles MCP tools with nested action segments', () => {
    const result = classify('mcp__srv__a__b', {});
    expect(result.actionType).toBe('mcp.srv.a.b');
  });

  it('returns unknown.ToolName for unmapped tools', () => {
    const result = classify('SomethingNew', {});
    expect(result.actionType).toBe('unknown.SomethingNew');
  });

  it('handles null/undefined input gracefully', () => {
    const result = classify('Read', null);
    expect(result.actionType).toBe('safe.read.file');
    expect(result.resource).toBeDefined();
  });

  it('extracts url for WebFetch', () => {
    const result = classify('WebFetch', { url: 'https://example.com/api' });
    expect(result.resource).toBe('https://example.com/api');
  });

  it('extracts query for WebSearch', () => {
    const result = classify('WebSearch', { query: 'search term' });
    expect(result.resource).toBe('search term');
  });
});

describe('isSafeRead', () => {
  it('returns true for safe.read.file', () => {
    expect(isSafeRead('safe.read.file')).toBe(true);
  });

  it('returns true for safe.read.glob', () => {
    expect(isSafeRead('safe.read.glob')).toBe(true);
  });

  it('returns true for safe.read.meta', () => {
    expect(isSafeRead('safe.read.meta')).toBe(true);
  });

  it('returns false for filesystem.write', () => {
    expect(isSafeRead('filesystem.write')).toBe(false);
  });

  it('returns false for code.exec', () => {
    expect(isSafeRead('code.exec')).toBe(false);
  });

  it('returns false for network.http', () => {
    expect(isSafeRead('network.http')).toBe(false);
  });
});

describe('sanitize', () => {
  it('redacts Anthropic API keys', () => {
    const result = sanitize('key is sk-ant-abc123xyz456');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-ant-');
  });

  it('redacts OpenAI API keys', () => {
    const result = sanitize('key is sk-abcdef123456');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const result = sanitize('Authorization: Bearer eyJhbGciOiJI');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('eyJhbGci');
  });

  it('redacts GitHub PATs', () => {
    expect(sanitize('token ghp_abc123def456')).toContain('[REDACTED]');
  });

  it('redacts GitLab PATs', () => {
    expect(sanitize('token glpat-abc123-def456')).toContain('[REDACTED]');
  });

  it('redacts Slack tokens', () => {
    expect(sanitize('xoxb-123456-abcdef')).toContain('[REDACTED]');
    expect(sanitize('xoxp-123456-abcdef')).toContain('[REDACTED]');
  });

  it('redacts KEY=value pairs', () => {
    expect(sanitize('API_KEY=supersecretvalue')).toContain('[REDACTED]');
  });

  it('redacts authensor tokens', () => {
    expect(sanitize('authensor_abc123')).toContain('[REDACTED]');
  });

  it('truncates long strings to 200 chars', () => {
    const long = 'a'.repeat(300);
    expect(sanitize(long).length).toBe(200);
  });

  it('handles null input', () => {
    expect(sanitize(null)).toBe('');
  });

  it('handles undefined input', () => {
    expect(sanitize(undefined)).toBe('');
  });

  it('handles number input', () => {
    expect(sanitize(42)).toBe('42');
  });

  it('passes through clean strings unchanged', () => {
    expect(sanitize('/tmp/output.txt')).toBe('/tmp/output.txt');
  });
});
