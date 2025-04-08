
"""Test items db."""
import pytest
from sharedstate.db_sqlite import SqliteDB

SQLITE_CONFIG = {
    "db_name": ":memory:",
    "db_table": "items",
}


@pytest.fixture
async def db():
    db_instance = SqliteDB(SQLITE_CONFIG)
    await db_instance.open()
    yield db_instance
    await db_instance.close()


@pytest.mark.asyncio
@pytest.mark.filterwarnings("ignore:Table '.*' already exists")
async def test_db(db):
    APP = "app"
    CHNL = "chnl"

    await db.delete(APP, CHNL)

    def as_insert_item(number):
        return {
            "id": f'id_{str(number)}',
            "data": f'data_{str(number)}'
        }

    def as_remove_item(number):
        return f'id_{str(number)}'

    insert_items = [as_insert_item(n) for n in range(10)]

    # update items
    await db.insert(APP, CHNL, insert_items)

    # get items
    items = await db.get_all(APP, CHNL)
    assert len(items) == 10

    # remove items
    remove_items = [as_remove_item(n) for n in range(5)]
    await db.remove(APP, CHNL, remove_items)

    # get items
    items = await db.get_all(APP, CHNL)
    assert len(items) == 5

    # delete items
    await db.delete(APP, CHNL)

    # get items
    items = await db.get_all(APP, CHNL)
    assert len(items) == 0


@pytest.mark.asyncio
@pytest.mark.filterwarnings("ignore:Table '.*' already exists")
async def test_channels(db):
    """Test listing two channels."""

    APP = "app"
    CHNL_A = "A"
    CHNL_B = "B"
    await db.delete(APP, CHNL_A)
    await db.delete(APP, CHNL_B)

    ITEM = {"id": "id", "data": "data"}
    items_A = await db.insert(APP, CHNL_A, ITEM)
    items_B = await db.insert(APP, CHNL_B, ITEM)
    assert len(items_A) == 1
    assert len(items_B) == 1

    res = await db.channels(APP)
    assert CHNL_A in res
    assert CHNL_B in res

    assert await db.delete(APP, CHNL_A) == 1
    assert await db.delete(APP, CHNL_B) == 1
