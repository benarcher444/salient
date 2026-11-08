// Loads .env into process.env. Nothing else. It must be the FIRST import of
// every entry point: ES imports are hoisted and evaluated before the importing
// module's body, so a module that reads process.env at import time (the
// database path, say) would otherwise see the unset value, silently.
try {
  process.loadEnvFile();
} catch {
  // No .env: variables come from the environment (systemd's EnvironmentFile).
}
