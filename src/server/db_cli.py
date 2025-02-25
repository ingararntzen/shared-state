import argparse
from src.server import db_items
from src.server import db_points
from src.server import db_intervals
from src.server import db_disjoint_intervals
import pprint


def main():
    parser = argparse.ArgumentParser(
        description="Database command-line interface.")

    # Positional argument: dbtype
    parser.add_argument(
        "dbtype",
        choices=["items", "points", "cues", "tracks"],
        help="The name of the database (items, points, cues, or tracks)."
    )

    # Positional argument: dbchannel
    parser.add_argument(
        "dbchannel",
        type=str,
        help="Database channel name."
    )

    # Positional argument: cmd
    parser.add_argument(
        "cmd",
        choices=["get", "clear"],
        help="The command to execute (get, or clear)."
    )

    args = parser.parse_args()

    print(f"{args.dbtype}.{args.dbchannel}.{args.cmd}")

    DB = None
    if args.dbtype == "items":
        DB = db_items.getDB()
    elif args.dbtype == "points":
        DB = db_points.getDB()
    elif args.dbtype == "cues":
        DB = db_intervals.getDB()
    elif args.dbtype == "tracks":
        DB = db_disjoint_intervals.getDB()

    if args.cmd == "get":
        pprint.pprint(list(DB.get(args.dbchannel)))
    elif args.cmd == "clear":
        DB.clear(args.dbchannel)


if __name__ == '__main__':
    main()
