"""Database for (key, value) items."""

import json
from src.server.db_base import BaseDB


###############################################################################
# DB SINGLETON
###############################################################################

_DB = None


def getDB(name="items"):
    """Return database singleton."""
    global _DB
    if not _DB:
        _DB = ItemsDB(name)
    return _DB


###############################################################################
# ITEM DB
###############################################################################

class ItemsDB(BaseDB):
    """
    Create (key, value) database.

    Keys are always strings - ints will be converted to string
    """

    ###########################################################################
    # DB
    ###########################################################################

    def sql_tables(self):
        """Define sql tables. Overridden by subclass."""
        return [(
            f"CREATE TABLE IF NOT EXISTS {self.table()} ("
            "chnl VARCHAR(128) NOT NULL,"
            "id VARCHAR(32) NOT NULL,"
            "ctime TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),"
            "value VARCHAR(2048),"
            "PRIMARY KEY (chnl, id))"
        )]

    def sql_indexes(self):
        """Define sql indexes. Overridden by subclass."""
        return []

    ###########################################################################
    # ITEMS
    ###########################################################################

    def as_item(self, record):
        """Convert a database record to item."""
        chnl, key, ts, value = record
        return {
            "key": key,
            # "ts": datetime_to_string(ts),
            "val": json.loads(value)
        }

    ###########################################################################
    # INSERT
    ###########################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        return (
            f"INSERT INTO {self.table()} "
            "(chnl, id, value) "
            "VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "value = VALUES(value)"
        )

    def insert_args(self, chnl, item):
        """Create args for insert SQL statement."""
        _value = json.dumps(item.get("val", None))
        return (chnl, item["key"], _value)
