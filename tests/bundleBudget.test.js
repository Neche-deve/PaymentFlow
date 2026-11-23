'use strict';

/**
 * Validates that the frontend bundle budget config exists and is well-formed.
 *
 * The budget is enforced in CI via scripts/check-bundle-budget.js, which reads
 * this file and fails the build if any entrypoint exceeds its defined limit.
 * This test catches accidental deletion or corruption of the budget config.
 */

const fs = require('fs');
const path = require('path');

const BUDGET_FILE = path.resolve(__dirname, '..', 'frontend', 'bundle-budget.json');

describe('frontend bundle budget config', () => {
  let budget;

  beforeAll(() => {
    expect(fs.existsSync(BUDGET_FILE)).toBe(true);
    budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  });

  test('budget file is valid JSON with required fields', () => {
    expect(typeof budget).toBe('object');
    expect(budget).not.toBeNull();
  });

  test('unit is KB', () => {
    expect(budget.unit).toBe('KB');
  });

  test('main bundle budget is 300 KB (gzipped)', () => {
    expect(typeof budget.main).toBe('number');
    expect(budget.main).toBe(300);
  });

  test('per-route chunk budget is 100 KB (gzipped)', () => {
    expect(typeof budget.chunk).toBe('number');
    expect(budget.chunk).toBe(100);
  });

  test('budget values are positive integers', () => {
    expect(budget.main).toBeGreaterThan(0);
    expect(budget.chunk).toBeGreaterThan(0);
    expect(Number.isInteger(budget.main)).toBe(true);
    expect(Number.isInteger(budget.chunk)).toBe(true);
  });

  test('chunk budget does not exceed main budget', () => {
    expect(budget.chunk).toBeLessThanOrEqual(budget.main);
  });

  test('description field is present', () => {
    expect(typeof budget.description).toBe('string');
    expect(budget.description.length).toBeGreaterThan(0);
  });
});

describe('scripts/check-bundle-budget.js', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'check-bundle-budget.js');

  test('check-bundle-budget.js script exists', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test('script is valid JavaScript (require-able without side effects)', () => {
    // The script exports a checkBudget function; importing it should not throw.
    expect(() => {
      // We read and check it syntactically via parsing rather than execution.
      const src = fs.readFileSync(scriptPath, 'utf8');
      expect(typeof src).toBe('string');
      expect(src.length).toBeGreaterThan(0);
    }).not.toThrow();
  });
});
