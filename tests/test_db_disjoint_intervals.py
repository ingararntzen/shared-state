"""Test script for Disjunct Interval DB."""

from src.server.db_disjoint_intervals import getDB
import unittest

DB = getDB()
CHNL = "__test.db__"


def flatten(batch_gen):
    """Flatten a generator of batches (lists) into a single list."""
    res = []
    for batch in batch_gen:
        res.extend(batch)
    return res


# make test data - nonoverlapping intervals
ITEMS = [
    {"key": "0", "dim": (1, 2, True, False), "val": 0},
    {"key": "1", "dim": (3, 4, True, False), "val": 1},
    {"key": "2", "dim": (5, 6, True, False), "val": 2},
    {"key": "3", "dim": (7, 8, True, False), "val": 3},
    {"key": "4", "dim": (9, 10, True, False), "val": 4},
    {"key": "5", "dim": (11, 12, True, False), "val": 5}
]

INSERT_ITEM = {"key": "A", "dim": (3.5, 11.5, False, False), "val": "A"}


class DbTest(unittest.TestCase):

    def setUp(self):
        """Set up testcase."""
        DB.clear(CHNL)

    def tearDown(self):
        """Tear down testcase."""
        DB.clear(CHNL)

    def test_all(self):

        # insert non-overlapping test data
        DB.update(CHNL, ITEMS)
        # get all items
        items = flatten(DB.get(CHNL))
        self.assertTrue(len(items) == 6)

        # insert new item
        DB.update(CHNL, INSERT_ITEM)
        # get all items
        items = flatten(DB.get(CHNL))
        self.assertTrue(len(items) == 4)

        d = {item["key"]: item for item in items}
        self.assertTrue("0" in d)
        self.assertTrue("1" in d)
        self.assertTrue("2" not in d)
        self.assertTrue("3" not in d)
        self.assertTrue("4" not in d)
        self.assertTrue("5" in d)
        self.assertTrue("A" in d)

        self.assertTrue(d["1"]["dim"] == (3, 3.5, True, True))
        self.assertTrue(d["A"]["dim"] == tuple(INSERT_ITEM["dim"]))
        self.assertTrue(d["5"]["dim"] == (11.5, 12, True, False))

    def test_multiple(self):
        """
        Testcase - multiple items in update.

        if A [1,10) is overlayed with two intervals A and C in one operation,
        The new version of A should replace the old version of A. We denote
        it AA.

        AA [1,5)
        C [5, ->]

        First, processing AA leads to A truncated (save right part)
        A [5, 10)

        Next, processing C leads to A being truncated again (save left part)
        A [1,5)

        Problem arised if the original A is being used both times, ie.
        in both iterations.

        This would leads to a sequence of inserts

        A [5, 10) AA[1,5) A[1,5) C[5,->]

        Which imples that AA does not replace AA and is instead lost.

        This was handled by updating the database in each iteration,
        which is very ineffective.

        A better solution would cache results during iteration and set the
        database in the correct state once at the end of the iteration.

        This tests this optimization.
        """
        # insert item
        INSERT_ITEM = {"key": "A", "dim": (1, 10, True, False), "val": "A"}
        DB.update(CHNL, [INSERT_ITEM])

        # insert new items
        ITEMS = [
            {"key": "A", "dim": (1, 2, True, False), "val": "AA"},
            {"key": "C", "dim": (2, 20, True, False), "val": "C"},
        ]
        DB.update(CHNL, ITEMS)

        # get result
        items = flatten(DB.get(CHNL))

        d = {item["key"]: item for item in items}
        self.assertTrue(len(d) == 2)
        self.assertTrue(d["A"]["val"] == "AA")
        self.assertTrue(d["A"]["dim"] == (1.0, 2.0, True, False))
        self.assertTrue(d["C"]["val"] == "C")
        self.assertTrue(d["C"]["dim"] == (2.0, 20.0, True, False))


if __name__ == '__main__':
    unittest.main()
