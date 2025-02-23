
def get_items(db):

    intervals = [

        # outside left
        ("A1", 1, 2, True, False),
        # outside right
        ("A2", 12, 14, True, False),

        # outside left touching low
        ("B1", 1, 4, True, False),
        ("B2", 1, 4, True, True),

        # outside right - touching high
        ("B3", 10, 12, False, False),
        ("B4", 10, 12, True, False),

        # overlap low
        ("C1", 1, 6, True, False),

        # overlap high
        ("C2", 6, 12, True, False),

        # inside - touching low
        ("D1", 4, 6, False, False),
        ("D2", 4, 6, True, False),

        # inside - touching high
        ("D3", 6, 10, True, False),
        ("D4", 6, 10, True, True),

        # inside touching low and high
        ("D5", 4, 10, False, False),
        ("D6", 4, 10, True, False),
        ("D7", 4, 10, False, True),
        ("D8", 4, 10, True, True),


        # touching low - right of high
        ("E1", 4, 12, False, False),
        ("E2", 4, 12, True, False),

        # left of low, touching high
        ("E3", 1, 10, True, False),
        ("E4", 1, 10, True, True),

        # overlapping
        ("F", 1, 12, False, True),

        # singulars
        ("G1", 1, 1, True, True),
        ("G2", 4, 4, True, True),
        ("G3", 6, 6, True, True),
        ("G4", 10, 10, True, True),
        ("G5", 12, 12, True, True),

        ("extra", 124, 124, True, True),
    ]

    if db == "items":
        def f(itv):
            return {
                "key": itv[0],
                "val": itv[1:]
            }
        return [f(itv) for itv in intervals]
    elif db == "points":
        def f(itv):
            return {
                "key": itv[0],
                "dim": itv[1],
                "val": itv[1:]
            }
        return [f(itv) for itv in intervals]
    elif db in ["cues", "tracks"]:
        def f(itv):
            return {
                "key": itv[0],
                "dim": itv[1:],
                "val": itv[1:]
            }
        return [f(itv) for itv in intervals]

    return []


if __name__ == '__main__':

    import sys
    import pprint
    
    from src.server import db_items
    from src.server import db_points
    from src.server import db_intervals
    from src.server import db_disjoint_intervals

    if len(sys.argv) == 1:
        usage = """
        python init_db.py cmd db chnl

        cmd: "get" | "update" | "clear"
        db: "items" | "points" | "cues" | "tracks"
        chnl: "test"
        """
        print(usage)
        sys.exit()

    cmd = "read" if len(sys.argv) < 2 else sys.argv[1]
    db = "items" if len(sys.argv) < 3 else sys.argv[2]
    chnl = "test" if len(sys.argv) < 4 else sys.argv[3]

    if db == "items":
        DB = db_items.getDB()
    elif db == "points":
        DB = db_points.getDB()
    elif db == "cues":
        DB = db_intervals.getDB()
    elif db == "tracks":
        DB = db_disjoint_intervals.getDB()
    else:
        print(f'illegal db: {db}')
        sys.exit()

    print(cmd, chnl, db)

    if cmd == "get":
        pprint.pprint(list(DB.get(chnl)))
    elif cmd == "update":
        items = get_items(db)
        DB.update(chnl, items)
    elif cmd == "clear":
        DB.clear(chnl)
