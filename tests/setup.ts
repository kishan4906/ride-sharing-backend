import dotenv from 'dotenv';
import path from 'path';

// Loaded via vitest.config.ts's `setupFiles`, BEFORE any test file (and
// therefore before any src/ module that reads `env` at import time) runs.
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
