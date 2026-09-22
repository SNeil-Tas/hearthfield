import { defineConfig } from 'vitest/config';

// Optional large-colony endurance audit; the regular suite contains a ten-day ledger test.
export default defineConfig({ test: { include: ['tests/audit/**/*.test.ts'] } });
