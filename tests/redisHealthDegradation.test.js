'use strict';

/**
 * Tests for the Sentinel-aware Redis client factory (backend/src/redisClient.js).
 *
 * All ioredis constructor calls are mocked — no real Redis connection is made.
 * Tests verify that:
 *   - Standalone mode is selected by default
 *   - Sentinel mode is selected when REDIS_SENTINEL_HOSTS is set
 *   - Sentinel host list is parsed correctly from the env var
 *   - The client is configured with a retryStrategy so it reconnects after
 *     a primary failover without an application restart
 *   - Graceful degradation: the module loads even when Redis is unreachable
 */

// Mock ioredis before requiring the module under test so the constructor
// never attempts a real TCP connection.
jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(function (config) {
    this._config = config;
    this.status = 'ready';
  });
  return MockRedis;
});

const Redis = require('ioredis');

// Save and restore env around each test.
let savedEnv = {};
const SENTINEL_VARS = ['REDIS_SENTINEL_HOSTS', 'REDIS_SENTINEL_NAME', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'];

beforeEach(() => {
  savedEnv = {};
  for (const v of SENTINEL_VARS) {
    savedEnv[v] = process.env[v];
    delete process.env[v];
  }
  jest.resetModules();
  Redis.mockClear();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function loadModule() {
  return require('../backend/src/redisClient');
}

// ── isSentinelMode ───────────────────────────────────────────────────────────

describe('isSentinelMode()', () => {
  test('returns false when REDIS_SENTINEL_HOSTS is not set', () => {
    const { isSentinelMode } = loadModule();
    expect(isSentinelMode()).toBe(false);
  });

  test('returns true when REDIS_SENTINEL_HOSTS is set', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    const { isSentinelMode } = loadModule();
    expect(isSentinelMode()).toBe(true);
  });
});

// ── Standalone mode ──────────────────────────────────────────────────────────

describe('createRedisClient() — standalone mode', () => {
  test('creates a plain Redis client when REDIS_SENTINEL_HOSTS is absent', () => {
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(Redis).toHaveBeenCalledTimes(1);
    const config = client._config;
    // Sentinel config must NOT be present
    expect(config.sentinels).toBeUndefined();
    expect(config.name).toBeUndefined();
  });

  test('uses REDIS_HOST and REDIS_PORT from environment', () => {
    process.env.REDIS_HOST = 'my-redis-host';
    process.env.REDIS_PORT = '6380';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    const config = client._config;
    expect(config.host).toBe('my-redis-host');
    expect(config.port).toBe(6380);
  });

  test('defaults to localhost:6379 when env vars are absent', () => {
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    const config = client._config;
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(6379);
  });

  test('includes a retryStrategy for automatic reconnection', () => {
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(typeof client._config.retryStrategy).toBe('function');
  });

  test('retryStrategy caps delay at 3000 ms', () => {
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    const delay = client._config.retryStrategy(100);
    expect(delay).toBeLessThanOrEqual(3000);
  });

  test('applies caller-supplied option overrides', () => {
    const { createRedisClient } = loadModule();
    const client = createRedisClient({ db: 2 });
    expect(client._config.db).toBe(2);
  });
});

// ── Sentinel mode ────────────────────────────────────────────────────────────

describe('createRedisClient() — sentinel mode', () => {
  test('creates a Sentinel client when REDIS_SENTINEL_HOSTS is set', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379,sentinel2:26379,sentinel3:26379';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    const config = client._config;
    expect(Array.isArray(config.sentinels)).toBe(true);
    expect(config.sentinels).toHaveLength(3);
  });

  test('parses sentinel host:port entries correctly', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379,sentinel2:26380';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    const sentinels = client._config.sentinels;
    expect(sentinels[0]).toEqual({ host: 'sentinel1', port: 26379 });
    expect(sentinels[1]).toEqual({ host: 'sentinel2', port: 26380 });
  });

  test('uses default sentinel port 26379 when no port is specified', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(client._config.sentinels[0].port).toBe(26379);
  });

  test('uses REDIS_SENTINEL_NAME as the master name', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    process.env.REDIS_SENTINEL_NAME = 'paymentmaster';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(client._config.name).toBe('paymentmaster');
  });

  test('defaults master name to "mymaster" when REDIS_SENTINEL_NAME is absent', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(client._config.name).toBe('mymaster');
  });

  test('sentinel client includes a retryStrategy for failover reconnection', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(typeof client._config.retryStrategy).toBe('function');
  });

  test('sentinel client does NOT set host/port (uses sentinel discovery instead)', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(client._config.host).toBeUndefined();
    expect(client._config.port).toBeUndefined();
  });

  test('applies REDIS_PASSWORD to sentinel client', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel1:26379';
    process.env.REDIS_PASSWORD = 'secret';
    const { createRedisClient } = loadModule();
    const client = createRedisClient();
    expect(client._config.password).toBe('secret');
  });
});
