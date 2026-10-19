#!/usr/bin/env node
import { materializeOwntracks } from "./owntracks/materialize.js";
import { serveOwntracks } from "./server.js";

const [command, source, ...rest] = process.argv.slice(2);

function parseServeArgs(args: string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 8080;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--host" && args[i + 1]) host = args[i + 1];
    if (args[i] === "--port" && args[i + 1]) port = Number(args[i + 1]);
  }
  return { host, port };
}

async function main(): Promise<number> {
  if (command === "serve" && source === "owntracks") {
    const { host, port } = parseServeArgs(rest);
    serveOwntracks(host, port);
    return 0;
  }

  if (command === "materialize" && source === "owntracks") {
    const count = await materializeOwntracks();
    console.error(`materialized ${count} location row(s)`);
    return 0;
  }

  console.error(`Usage: lifelog-ingest serve owntracks | materialize owntracks`);
  return 1;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
