"""
Database for (key, pos, value) items.


Items associated with a point on an dimension. Lookup targets a range on
this dimension, and is supported by a point index. Typically, the
dimension is a timeline.
"""

import json
from src.server.db_base import BaseDB


###############################################################################
# DB SINGLETON
###############################################################################

_DB = None


def getDB(name="points"):
    """Return database singleton."""
    global _DB
    if not _DB:
        _DB = PointsDB(name)
    return _DB


###############################################################################
# Points DB
###############################################################################

class PointsDB(BaseDB):
    """
    Create (key, pos, value) database.

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
            "pos DOUBLE DEFAULT NULL,"
            "ctime TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),"
            "value VARCHAR(2048),"
            "PRIMARY KEY (chnl, id))"
        )]

    def sql_indexes(self):
        """Define sql indexes. Overridden by subclass."""
        return [
            f"CREATE INDEX idx_pos ON {self.table()} (pos)",
        ]

    ###########################################################################
    # ITEMS
    ###########################################################################

    def as_item(self, record):
        """Convert a database record to item."""
        chnl, key, pos, ctime, value = record
        return {
            "key": key,
            "dim": [pos],
            "val": json.loads(value)
        }

    ###########################################################################
    # INSERT
    ###########################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        return (
            f"INSERT INTO {self.table()} "
            "(chnl, id, pos, value) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "pos = VALUES(pos), "
            "value = VALUES(value)"
        )

    def insert_args(self, chnl, item):
        """Create args for insert SQL statement."""
        key = str(item["key"])
        if "dim" not in item:
            # TODO : could allow items without dim?
            return
        # support dim as number
        dim = item["dim"]
        if isinstance(dim, (list, tuple)) and len(dim) > 0:
            dim = dim[0]
        if type(dim) not in (int, float):
            return
        _value = json.dumps(item.get("val", None))
        return (chnl, key, dim, _value)

    ###########################################################################
    # LOOKUP
    ###########################################################################

    def lookup_supported(self):
        """Lookup is supported."""
        return True

    def lookup_sql(self, chnl, interval, use_brackets=True):
        """Create SQL string for lookup."""
        A, B, A_closed, B_closed = interval

        if A is None and B is None:
            return self.get_sql()
        elif A is None:
            lt_high = "<" if (use_brackets and not B_closed) else "<="
            return (
                f"SELECT * FROM {self.table()} "
                "WHERE chnl=%s"
                "AND"
                f"(pos {lt_high} %s)"
            )
        elif B is None:
            lt_low = "<" if (use_brackets and not A_closed) else "<="
            return (
                    f"SELECT * FROM {self.table()} "
                    "WHERE chnl=%s"
                    "AND"
                    f"(%s {lt_low} pos)"
                )
        else:
            lt_low = "<" if (use_brackets and not A_closed) else "<="
            lt_high = "<" if (use_brackets and not B_closed) else "<="
            return (
                f"SELECT * FROM {self.table()} "
                "WHERE chnl=%s"
                "AND"
                f"(%s {lt_low} pos AND pos {lt_high} %s)"
            )

    def lookup_args(self, chnl, interval, use_brackets=True):
        """Create args for lookup SQL."""
        A, B, _, _ = interval
        if A is None and B is None:
            return self.get_args(chnl)
        elif A is None:
            return (chnl, B)
        elif B is None:
            return (chnl, A)
        else:
            return (chnl, A, B)
