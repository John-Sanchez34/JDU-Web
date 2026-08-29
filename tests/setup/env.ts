import { config } from "dotenv";

// Loaded before every test file. `lib/env.ts` validates process.env at import
// time, so any module that transitively imports it — which includes the pure
// helpers in `lib/guards.ts` by way of `lib/auth.ts` — throws during module
// resolution unless the real environment is present first.
config({ path: ".env" });

// Integration tests exercise the delivery runner end to end. Nothing in a test
// run may reach the real provider, so the transport is pinned here rather than
// left to whatever `.env` happens to contain.
process.env.EMAIL_TRANSPORT = "capture";
