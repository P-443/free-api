// ═══════════════════════════════════════════════════════════════
//  config — centralized environment & settings
//  Single source of truth for ALL configuration.
//  No other module reads process.env directly.
// ═══════════════════════════════════════════════════════════════

export const PORT = parseInt(process.env.PORT || '9000', 10);

export const REDIS_URL = process.env.REDIS_URL || '';
export const REDIS_ENABLED = REDIS_URL.length > 0;

export const POOL_WORKERS = parseInt(process.env.POOL_WORKERS || '0', 10);

export const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

export const TURNSTILE_SOLVER_URL = process.env.TURNSTILE_SOLVER_URL || 'http://127.0.0.1:8191/solve';

// Token pool settings
export const HCAPTCHA_SITEKEY = process.env.HCAPTCHA_SITEKEY || '';
export const HCAPTCHA_SITEURL = process.env.HCAPTCHA_SITEURL || '';
export const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || '';
export const TURNSTILE_SITEURL = process.env.TURNSTILE_SITEURL || '';

export const TARGET_POOL = parseInt(process.env.TARGET_POOL || '50', 10);
export const LOW_POOL = parseInt(process.env.LOW_POOL || '10', 10);
export const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '20', 10);

// Platform
export const IS_LINUX = process.platform === 'linux';
export const DISPLAY = process.env.DISPLAY;

// Default solve timeout
export const DEFAULT_TIMEOUT = 45;
