import { startApiServer } from "../src/api/server";

const parsePort = (): number => {
  const raw = process.env.API_PORT?.trim() || "8787";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid API_PORT value: ${raw}`);
  }
  return parsed;
};

function main(): void {
  const port = parsePort();
  const server = startApiServer(port);
  console.log(`API server listening on http://127.0.0.1:${port}`);
  console.log("Endpoints: POST /api/snapshot, POST /api/recommend, POST /api/verify");
  console.log("Telemetry mode: send { telemetry: frontend-telemetry-envelope-v1 } to /api/snapshot and /api/recommend");

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`Received ${signal}, shutting down API server...`);
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
