from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lifelog-ingest")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run-all", help="Run all enabled sources (stub)")

    run = sub.add_parser("run", help="Run one source (stub)")
    run.add_argument(
        "source",
        choices=["manual", "activitywatch", "garmin", "apple_health", "owntracks"],
    )

    serve = sub.add_parser("serve", help="Start HTTP ingest server")
    serve.add_argument("source", choices=["owntracks"])
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)

    mat = sub.add_parser("materialize", help="Bronze → staging inbox")
    mat.add_argument("source", choices=["owntracks"])

    args = parser.parse_args(argv)

    if args.command == "serve" and args.source == "owntracks":
        import uvicorn

        from lifelog_ingest.sources.owntracks.webhook import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port)
        return 0

    if args.command == "materialize" and args.source == "owntracks":
        from lifelog_ingest.sources.owntracks.materialize import materialize_owntracks

        count = materialize_owntracks()
        print(f"materialized {count} location row(s)", file=sys.stderr)
        return 0

    print(f"[stub] lifelog-ingest {args.command}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
