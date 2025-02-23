"""Test script for Interval DB."""

from src.server.db_intervals import getDB

DB = getDB()
CHNL = "__test.db__"


def flatten(batch_gen):
    """Flatten a generator of batches (lists) into a single list."""
    res = []
    for batch in batch_gen:
        res.extend(batch)
    return res


def verify(expect, result):
    expect = set(expect)
    result = set(result)
    wrong = result.difference(expect)
    missing = expect.difference(result)
    assert len(expect) == len(result)
    assert len(wrong) == 0
    assert len(missing) == 0


def test_all():
    """Test main functionality."""
    DB.clear(CHNL)

    def as_update_item(number):
        return {
            "key": f'key_{str(number)}',
            "dim": [number, number+1, True, False],
            "val": f'value_{str(number)}'
        }

    def as_remove_item(number):
        return {
            "key": f'key_{str(number)}'
        }

    update_items = [as_update_item(n) for n in range(10)]

    # update items
    DB.insert(CHNL, update_items)

    # get items
    items = flatten(DB.get(CHNL))
    assert len(items) == 10

    # remove items
    remove_items = [as_remove_item(n) for n in range(5)]
    remove_keys = [item["key"] for item in remove_items]
    DB.remove(CHNL, remove_keys)

    # get items
    items = flatten(DB.get(CHNL))
    assert len(items) == 5

    # clear
    DB.clear(CHNL)

    # get items
    items = []
    for batch in DB.get(CHNL):
        items.extend(batch)
    assert len(items) == 0


def test_lookup():
    """Test lookup for given search interval."""

    DB.clear(CHNL)

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

    def f(itv):
        return {
            "key": itv[0],
            "dim": itv[1:],
            "val": itv[0]
        }

    cues = [f(itv) for itv in intervals]

    # add to database
    DB.insert(CHNL, cues)

    # search intervals
    itv_1 = (4, 10, False, False)
    itv_2 = (4, 10, False, True)
    itv_3 = (4, 10, True, False)
    itv_4 = (4, 10, True, True)

    # covers search interval 1
    # print("lookup", itv_1)
    res = flatten(DB.lookup(CHNL, itv_1))
    result_keys = [cue["key"] for cue in res]
    expect_keys = [
        "C1", "C2",
        "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
        "E1", "E2", "E3", "E4", "F", "G3"
    ]
    verify(expect_keys, result_keys)

    # covers search interval 2
    # print("lookup", itv_2)
    res = flatten(DB.lookup(CHNL, itv_2))
    result_keys = [cue["key"] for cue in res]
    expect_keys = [
        "B4", "C1", "C2",
        "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
        "E1", "E2", "E3", "E4", "G3", "G4", "F"]
    verify(expect_keys, result_keys)

    # covers search interval 3
    # print("lookup", itv_3)
    res = flatten(DB.lookup(CHNL, itv_3))
    result_keys = [cue["key"] for cue in res]
    expect_keys = [
        "B2", "C1", "C2",
        "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
        "E1", "E2", "E3", "E4", "G3", "G2", "F"]
    verify(expect_keys, result_keys)

    # covers search interval 4
    # print("lookup", itv_4)
    res = flatten(DB.lookup(CHNL, itv_4))
    result_keys = [cue["key"] for cue in res]
    expect_keys = [
        "B2", "B4", "C1", "C2",
        "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8",
        "E1", "E2", "E3", "E4", "G2", "G3", "G4", "F"]
    verify(expect_keys, result_keys)

    # test unbounded left
    itv = (None, 1, True, True)
    res = next(DB.lookup(CHNL, itv))
    result_keys = [cue["key"] for cue in res]
    expect_keys = [tup[0] for tup in intervals if tup[1] == 1 and tup[3]]
    verify(expect_keys, result_keys)

    # test unbounded right
    itv = (100, None, True, True)
    res = next(DB.lookup(CHNL, itv))
    result_keys = [cue["key"] for cue in res]
    expect_keys = ["extra"]
    verify(expect_keys, result_keys)


def test_infinite():
    """test insert and lookup with infinit intervals"""

    DB.clear(CHNL)

    # intervals with infinite values
    itvs = [
        ("1", 3, None, True, True),
        ("2", None, 1, True, True),
        ("3", None, None, True, True),
        ("4", 0, 4, True, True),
    ]

    def f(itv):
        return {
            "key": itv[0],
            "dim": itv[1:],
            "val": itv[0]
        }

    cues = [f(i) for i in itvs]

    # insert
    DB.insert(CHNL, cues)

    # test regular search
    res = flatten(DB.lookup(CHNL, [-10, 10, True, False]))
    result_keys = [item["key"] for item in res]
    expect_keys = ["1", "2", "3", "4"]
    verify(expect_keys, result_keys)

    # test left-open lookup
    res = flatten(DB.lookup(CHNL, [None, 2, True, False]))
    result_keys = [item["key"] for item in res]
    expect_keys = ["2", "3", "4"]
    verify(expect_keys, result_keys)

    # test right-open lookup
    res = flatten(DB.lookup(CHNL, [2, None, True, False]))
    result_keys = [item["key"] for item in res]
    expect_keys = ["1", "3", "4"]
    verify(expect_keys, result_keys)

    # test open lookup
    res = flatten(DB.lookup(CHNL, [None, None, True, False]))
    result_keys = [item["key"] for item in res]
    expect_keys = ["1", "2", "3", "4"]
    verify(expect_keys, result_keys)

