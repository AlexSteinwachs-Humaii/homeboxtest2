import { startServer } from "./boot.ts";

if (import.meta.main) {
  try {
    const running = startServer(process.env, process.argv.slice(2));
    const shutdown = () => {
      running.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
