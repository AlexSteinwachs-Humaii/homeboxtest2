import { startServer } from "./boot.ts";

if (import.meta.main) {
  startServer(process.env, process.argv.slice(2))
    .then((running) => {
      const shutdown = () => {
        running.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
