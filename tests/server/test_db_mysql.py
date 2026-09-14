import json
import os
from pathlib import Path
import pytest
from sharedstate.db_mysql import MysqlDB, resolve_config_val

cfg_file = Path(__file__).resolve().parent.parent.parent / "cfg" / "sql.json"
if cfg_file.is_file():
    with open(cfg_file, "r", encoding="utf-8") as f:
        loaded = json.load(f)
        MYSQL_CONFIG = loaded["stores"][0]["config"]
else:
    MYSQL_CONFIG = {
        "db_type": "mysql",
        "db_name": "SHAREDSTATE_MYSQL_DB_NAME",
        "db_table": "SHAREDSTATE_MYSQL_DB_TABLE",
        "db_host": "SHAREDSTATE_MYSQL_DB_HOST",
        "db_user": "SHAREDSTATE_MYSQL_DB_USER",
        "db_password": "SHAREDSTATE_MYSQL_DB_PASSWORD"
    }

# Provide local test defaults if environment variables are not already defined
os.environ.setdefault("SHAREDSTATE_MYSQL_DB_NAME", "dcbase")
os.environ.setdefault("SHAREDSTATE_MYSQL_DB_TABLE", "items")
os.environ.setdefault("SHAREDSTATE_MYSQL_DB_HOST", "localhost")
os.environ.setdefault("SHAREDSTATE_MYSQL_DB_USER", "dcuser")
os.environ.setdefault("SHAREDSTATE_MYSQL_DB_PASSWORD", "GrefseFysa")


@pytest.fixture
async def db():
    db_instance = MysqlDB(MYSQL_CONFIG)
    try:
        await db_instance.open()
    except Exception as err:
        pytest.skip(f"MySQL database unavailable ({err}); skipping MySQL tests.")
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

    res = await db.resources(APP)
    assert CHNL_A in res
    assert CHNL_B in res

    assert await db.delete(APP, CHNL_A) == 1
    assert await db.delete(APP, CHNL_B) == 1


def test_resolve_config_val():
    os.environ["TEST_ENV_VAR_X"] = "hello_world"
    assert resolve_config_val("TEST_ENV_VAR_X") == "hello_world"
    assert resolve_config_val("${TEST_ENV_VAR_X}") == "hello_world"
    assert resolve_config_val("NON_EXISTENT_VAR_123", fallback="fallback_val") == "fallback_val"
    assert resolve_config_val("${NON_EXISTENT_VAR_123}", fallback="fallback_val") == "fallback_val"
    assert resolve_config_val("literal_string") == "literal_string"
    assert resolve_config_val("true") is True
    assert resolve_config_val("false") is False
    assert resolve_config_val(None, fallback="default") == "default"
