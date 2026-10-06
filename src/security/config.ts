export function integerSetting(name: string, fallback: number, min = 1, max = 1_000_000) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function booleanSetting(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

export function validateSecurityConfig() {
  const production = process.env.NODE_ENV === 'production';
  const redisEnabled = booleanSetting('REDIS_ENABLED', false);
  if (
    !process.env.JWT_SECRET ||
    (production &&
      (process.env.JWT_SECRET.length < 32 ||
        /replace|example|secret-password/i.test(process.env.JWT_SECRET)))
  ) {
    throw new Error(
      'JWT_SECRET must be configured; production requires a random secret of at least 32 characters',
    );
  }
  if (production && !process.env.CORS_ORIGINS)
    throw new Error('CORS_ORIGINS is required in production');
  if (redisEnabled && !process.env.REDIS_URL)
    throw new Error('REDIS_URL is required when REDIS_ENABLED=true');
  if (production && process.env.PG_SSL === 'false')
    throw new Error('PostgreSQL TLS is required in production');
  if (
    /(?:^|,)(?:true|0\.0\.0\.0\/0|::\/0)(?:,|$)/.test(process.env.TRUST_PROXY || '') ||
    /^\d+$/.test(process.env.TRUST_PROXY || '')
  ) {
    throw new Error(
      'TRUST_PROXY must contain explicit proxy IPs or CIDRs, never a boolean or hop count',
    );
  }
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((v) => v.trim());
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      (production && parsed.protocol !== 'https:')
    ) {
      throw new Error('CORS_ORIGINS must contain exact origins (HTTPS in production)');
    }
  }
  return { production, origins, redisEnabled };
}
