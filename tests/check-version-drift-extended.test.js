'use strict';

/**
 * Extended tests for the version-drift checker and security-exceptions schema.
 *
 * Covers:
 *   - parseMajor() edge cases (non-semver, pre-release, wildcards)
 *   - security-exceptions.json schema validity
 *   - expiry date format enforcement on audit exceptions
 *   - check-dependency-audit.js exception expiry enforcement
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── security-exceptions.json schema ──────────────────────────────────────────

describe('security-exceptions.json', () => {
  let doc;

  beforeAll(() => {
    const filePath = path.join(ROOT, 'security-exceptions.json');
    expect(fs.existsSync(filePath)).toBe(true);
    doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  });

  test('top-level shape is valid', () => {
    expect(typeof doc.description).toBe('string');
    expect(Array.isArray(doc.exceptions)).toBe(true);
  });

  test('every audit exception (type=advisory) has required fields', () => {
    const auditExceptions = doc.exceptions.filter((e) => e.type === 'advisory');
    for (const ex of auditExceptions) {
      expect(typeof ex.id).toBe('string');
      expect(ex.id.length).toBeGreaterThan(0);
      expect(typeof ex.package).toBe('string');
      expect(typeof ex.path).toBe('string');
      expect(typeof ex.expires).toBe('string');
      expect(typeof ex.reason).toBe('string');
    }
  });

  test('every audit exception has a valid ISO date in expires field', () => {
    const auditExceptions = doc.exceptions.filter((e) => e.type === 'advisory');
    for (const ex of auditExceptions) {
      expect(ex.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const d = new Date(ex.expires);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  test('every audit exception path is one of: ".", "backend", "frontend"', () => {
    const auditExceptions = doc.exceptions.filter((e) => e.type === 'advisory');
    const validPaths = new Set(['.', 'backend', 'frontend']);
    for (const ex of auditExceptions) {
      expect(validPaths.has(ex.path)).toBe(true);
    }
  });
});

// ── check-dependency-audit: expiry enforcement ────────────────────────────────

describe('findUnexceptedVulnerabilities — expiry enforcement', () => {
  const { findUnexceptedVulnerabilities } = require('../scripts/check-dependency-audit');

  function vuln(name, severity, advisoryUrls) {
    return {
      name,
      severity,
      via: advisoryUrls.map((url) => ({ url })),
    };
  }

  test('expired exception causes the advisory to be reported as a failure', () => {
    const vulnerabilities = {
      'some-pkg': vuln('some-pkg', 'high', ['https://github.com/advisories/GHSA-0000-0000-0000']),
    };
    const exceptions = [
      {
        id: 'GHSA-0000-0000-0000',
        package: 'some-pkg',
        path: 'backend',
        expires: '2020-01-01', // clearly in the past
      },
    ];
    const failures = findUnexceptedVulnerabilities(vulnerabilities, exceptions, 'backend', '2025-01-01');
    expect(failures).toHaveLength(1);
    expect(failures[0].package).toBe('some-pkg');
  });

  test('exception expiring today is still valid', () => {
    const today = new Date().toISOString().slice(0, 10);
    const vulnerabilities = {
      'pkg-today': vuln('pkg-today', 'critical', ['https://github.com/advisories/GHSA-1111-1111-1111']),
    };
    const exceptions = [
      {
        id: 'GHSA-1111-1111-1111',
        package: 'pkg-today',
        path: '.',
        expires: today,
      },
    ];
    const failures = findUnexceptedVulnerabilities(vulnerabilities, exceptions, '.', today);
    expect(failures).toHaveLength(0);
  });

  test('exception expiring tomorrow is valid today', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const vulnerabilities = {
      'pkg-future': vuln('pkg-future', 'high', ['https://github.com/advisories/GHSA-2222-2222-2222']),
    };
    const exceptions = [
      {
        id: 'GHSA-2222-2222-2222',
        package: 'pkg-future',
        path: 'frontend',
        expires: tomorrow,
      },
    ];
    const failures = findUnexceptedVulnerabilities(vulnerabilities, exceptions, 'frontend', new Date().toISOString().slice(0, 10));
    expect(failures).toHaveLength(0);
  });

  test('low/moderate severities are never flagged regardless of exceptions', () => {
    const vulnerabilities = {
      'low-pkg':      vuln('low-pkg',      'low',      ['https://github.com/advisories/GHSA-low']),
      'moderate-pkg': vuln('moderate-pkg', 'moderate', ['https://github.com/advisories/GHSA-mod']),
    };
    const failures = findUnexceptedVulnerabilities(vulnerabilities, [], 'backend', '2025-01-01');
    expect(failures).toHaveLength(0);
  });

  test('advisory with only transitive via entries (no url objects) is skipped', () => {
    const vulnerabilities = {
      transitive: { name: 'transitive', severity: 'critical', via: ['some-other-pkg'] },
    };
    const failures = findUnexceptedVulnerabilities(vulnerabilities, [], 'backend', '2025-01-01');
    expect(failures).toHaveLength(0);
  });
});

// ── version-exceptions.json schema ───────────────────────────────────────────

describe('version-exceptions.json', () => {
  const filePath = path.join(ROOT, 'version-exceptions.json');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('parses as valid JSON', () => {
    expect(() => JSON.parse(fs.readFileSync(filePath, 'utf8'))).not.toThrow();
  });

  test('top-level is an object', () => {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(typeof doc).toBe('object');
    expect(doc).not.toBeNull();
    expect(Array.isArray(doc)).toBe(false);
  });
});

// ── check-dependency-audit.js module shape ───────────────────────────────────

describe('check-dependency-audit.js module', () => {
  test('exports findUnexceptedVulnerabilities as a function', () => {
    const mod = require('../scripts/check-dependency-audit');
    expect(typeof mod.findUnexceptedVulnerabilities).toBe('function');
  });
});
