"""Test items db."""

from src.server.db_items import getDB
import unittest

DB = getDB("items")
CHNL = "__test__"


def flatten(batch_gen):
    """Flatten a generator of batches (lists) into a single list."""
    res = []
    for batch in batch_gen:
        res.extend(batch)
    return res


class DbTest(unittest.TestCase):

    def setUp(self):
        DB.clear(CHNL)

    def tearDown(self):
        DB.clear(CHNL)

    def test_all(self):

        def as_update_item(number):
            return {
                "key": f'key_{str(number)}',
                "val": f'val_{str(number)}'
            }

        def as_remove_item(number):
            return {
                "key": f'key_{str(number)}'
            }

        update_items = [as_update_item(n) for n in range(10)]

        # update items
        DB.update(CHNL, update_items)

        # get items
        items = flatten(DB.get(CHNL))
        self.assertEqual(len(items), 10)

        # remove items
        remove_items = [as_remove_item(n) for n in range(5)]
        DB.update(CHNL, remove_items)

        # get items
        items = flatten(DB.get(CHNL))
        self.assertEqual(len(items), 5)

        # clear
        DB.clear(CHNL)

        # get items
        items = []
        for batch in DB.get(CHNL):
            items.extend(batch)
        self.assertEqual(len(items), 0)

    def test_channels(self):
        """Test listing two channels."""
        CHNLS = ["A", "B"]
        ITEM = {"key": "key", "val": "val"}
        DB.update(CHNLS[0], ITEM)
        DB.update(CHNLS[1], ITEM)
        res = DB.channels()
        self.assertTrue(CHNLS[0] in res)
        self.assertTrue(CHNLS[1] in res)


if __name__ == '__main__':
    unittest.main()
