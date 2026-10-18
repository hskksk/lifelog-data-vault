from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lifelog-ingest")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run-all", help="Run all enabled sources (stub)")
    run = sub.add_parser("run", help="Run one source (stub)")
    run.add_argument("source", choices=["manual", "activitywatch", "garmin", "apple_health"])
    args = parser.parse_args(argv)
    print(f"[stub] lifelog-ingest {args.command}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
