// Container healthcheck. Replaces the Go helper binary: no shell, no wget.
const url = process.argv[2] ?? "http://127.0.0.1:7745/api/v1/status";
try {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`unexpected status: ${response.status}`);
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
process.exit(0);
