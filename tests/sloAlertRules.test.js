'use strict';

/**
 * Validates that SLO-level alert rules exist for issue #672 requirements:
 *
 *   - Payment failure rate > 1% for 5 min → Slack (warning)
 *   - P99 latency > 2 s → PagerDuty (critical)
 *
 * Also validates that the four required Grafana dashboards are provisioned
 * as JSON files in monitoring/grafana/dashboards/.
 */

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const monitoringDir  = path.resolve(__dirname, '..', 'monitoring');
const alertsDir      = path.join(monitoringDir, 'alerts');
const dashboardsDir  = path.join(monitoringDir, 'grafana', 'dashboards');

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function allAlertRules() {
  return fs
    .readdirSync(alertsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((file) => {
      const doc = readYaml(path.join(alertsDir, file));
      return (doc.groups || []).flatMap((g) =>
        (g.rules || []).map((r) => ({ ...r, _file: file }))
      );
    });
}

// ── SLO alert coverage ────────────────────────────────────────────────────────

describe('SLO alert rules (issue #672)', () => {
  let rules;
  beforeAll(() => {
    rules = allAlertRules();
  });

  test('a payment failure rate alert rule exists', () => {
    // Accepts any alert whose name contains "PaymentFail" or "PaymentError"
    // or "PaymentProcessing" with a failure-related annotation.
    const paymentFailAlerts = rules.filter(
      (r) =>
        /payment.*fail|payment.*error|payment.*processing/i.test(r.alert) ||
        /payment.*fail|failure.*rate/i.test(r.annotations?.description || '') ||
        /payment.*fail|failure.*rate/i.test(r.annotations?.summary || '')
    );
    expect(paymentFailAlerts.length).toBeGreaterThan(0);
  });

  test('a P99 latency critical alert rule exists', () => {
    const p99Alerts = rules.filter(
      (r) =>
        /p99|latency.*critical|latency.*high/i.test(r.alert) ||
        /p99|latency.*critical/i.test(r.annotations?.summary || '')
    );
    expect(p99Alerts.length).toBeGreaterThan(0);
  });

  test('P99 latency critical alert has severity: critical', () => {
    const p99Critical = rules.filter(
      (r) =>
        (/p99|latency.*critical/i.test(r.alert) ||
          /p99|latency.*critical/i.test(r.annotations?.summary || '')) &&
        r.labels?.severity === 'critical'
    );
    expect(p99Critical.length).toBeGreaterThan(0);
  });

  test('payment failure alert has severity: warning or critical', () => {
    const paymentFailAlerts = rules.filter(
      (r) =>
        /payment.*fail|payment.*error|payment.*processing/i.test(r.alert) &&
        ['warning', 'critical'].includes(r.labels?.severity)
    );
    expect(paymentFailAlerts.length).toBeGreaterThan(0);
  });

  test('ApiLatencyP99Critical alert uses a 2-second-or-higher threshold expression', () => {
    const p99 = rules.find((r) => r.alert === 'ApiLatencyP99Critical');
    expect(p99).toBeDefined();
    // Expression must reference a numeric threshold ≥ 2
    expect(p99.expr).toMatch(/>\s*[2-9]/);
  });
});

// ── Metrics endpoint implementation ──────────────────────────────────────────

describe('backend metrics implementation (issue #672)', () => {
  test('metrics/index.js exports registry', () => {
    const metrics = require('../backend/src/metrics');
    expect(metrics.registry).toBeDefined();
  });

  test('http_request_duration_seconds histogram is registered', async () => {
    const { registry } = require('../backend/src/metrics');
    const metricNames = (await registry.getMetricsAsJSON()).map((m) => m.name);
    expect(metricNames).toContain('http_request_duration_seconds');
  });

  test('queue_depth gauge is registered', async () => {
    const { registry } = require('../backend/src/metrics');
    const metricNames = (await registry.getMetricsAsJSON()).map((m) => m.name);
    expect(metricNames).toContain('queue_depth');
  });

  test('payments_total gauge is registered', async () => {
    const { registry } = require('../backend/src/metrics');
    const metricNames = (await registry.getMetricsAsJSON()).map((m) => m.name);
    expect(metricNames).toContain('payments_total');
  });
});

// ── Grafana dashboard provisioning ───────────────────────────────────────────

describe('Grafana dashboards provisioned (issue #672)', () => {
  const REQUIRED_DASHBOARDS = [
    'overview',
    'payments',
    'stellar',
    'queue-health',
  ];

  test('dashboards directory exists', () => {
    expect(fs.existsSync(dashboardsDir)).toBe(true);
  });

  test.each(REQUIRED_DASHBOARDS)('%s dashboard JSON exists', (name) => {
    const files = fs.readdirSync(dashboardsDir);
    const match = files.find((f) => f.toLowerCase().includes(name) && f.endsWith('.json'));
    expect(match).toBeDefined();
  });

  test.each(REQUIRED_DASHBOARDS)('%s dashboard is valid JSON with a title', (name) => {
    const files = fs.readdirSync(dashboardsDir);
    const filename = files.find((f) => f.toLowerCase().includes(name) && f.endsWith('.json'));
    if (!filename) return; // already caught above
    const dashboard = JSON.parse(
      fs.readFileSync(path.join(dashboardsDir, filename), 'utf8')
    );
    expect(typeof dashboard.title).toBe('string');
    expect(dashboard.title.length).toBeGreaterThan(0);
  });
});
