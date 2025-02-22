"""Test items db."""
from src.server.db_items import getDB


def flatten(batch_gen):
    """Flatten a generator of batches (lists) into a single list."""
    res = []
    for batch in batch_gen:
        res.extend(batch)
    return res


def test_db():

    CHNL = "__test__"
    DB = getDB("items")
    DB.clear(CHNL)

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
    assert len(items) == 10

    # remove items
    remove_items = [as_remove_item(n) for n in range(5)]
    DB.update(CHNL, remove_items)

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


def test_channels():
    """Test listing two channels."""
    DB = getDB("items")
    CHNL_A = "A"
    CHNL_B = "B"
    ITEM = {"key": "key", "val": "val"}
    DB.update(CHNL_A, ITEM)
    DB.update(CHNL_B, ITEM)
    res = DB.channels()
    assert CHNL_A in res
    assert CHNL_B in res
    DB.clear(CHNL_A)
    DB.clear(CHNL_A)
