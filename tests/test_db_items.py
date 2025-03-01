"""Test items db."""
import pytest
from src.server.db_items import ItemsDB


MYSQL_CONFIG = {
    "db_type": "mysql",
    "db_name": "dcbase",
    "db_table": "items",
    "db_host": "localhost",
    "db_user": "dcuser",
    "db_password": "GrefseFysa"
}
MYSQL_DB = ItemsDB(MYSQL_CONFIG)


SQLITE_CONFIG = {
    "db_type": "sqlite",
    "db_name": "dcbase",
    "db_table": "items"
}
SQLITE_DB = ItemsDB(SQLITE_CONFIG)


@pytest.mark.parametrize("DB", [SQLITE_DB, MYSQL_DB])
def test_db(DB):

    APP = "app"
    CHNL = "chnl"

    DB.clear(APP, CHNL)

    def as_update_item(number):
        return {
            "id": f'id_{str(number)}',
            "data": f'data_{str(number)}'
        }

    def as_remove_item(number):
        return {
            "id": f'id_{str(number)}'
        }

    update_items = [as_update_item(n) for n in range(10)]

    # update items
    DB.update(APP, CHNL, update_items)

    # get items
    items = list(DB.get_all(APP, CHNL))
    assert len(items) == 10

    # remove items
    remove_items = [as_remove_item(n) for n in range(5)]
    DB.update(APP, CHNL, remove_items)

    # get items
    items = list(DB.get_all(APP, CHNL))
    assert len(items) == 5

    # clear
    DB.clear(APP, CHNL)

    # get items
    items = list(DB.get_all(APP, CHNL))
    assert len(items) == 0


@pytest.mark.parametrize("DB", [SQLITE_DB, MYSQL_DB])
def test_channels(DB):
    """Test listing two channels."""
    APP = "app"
    CHNL_A = "A"
    CHNL_B = "B"
    DB.clear(APP, CHNL_A)
    DB.clear(APP, CHNL_B)
    ITEM = {"id": "id", "data": "data"}
    DB.update(APP, CHNL_A, ITEM)
    DB.update(APP, CHNL_B, ITEM)
    res = DB.channels(APP)
    assert CHNL_A in res
    assert CHNL_B in res
    DB.clear(APP, CHNL_A)
    DB.clear(APP, CHNL_B)
