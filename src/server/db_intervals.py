"""Database for storing channels of (key, interval, value) items."""

import sys
import json
from src.server.db_base import BaseDB
from src.server.intervals import check_interval

POS_INF = sys.float_info.max
NEG_INF = -sys.float_info.max

###############################################################################
# DB SINGLETON
###############################################################################

_DB = None


def getDB(name="intervals"):
    """Return database singleton."""
    global _DB
    if not _DB:
        _DB = IntervalDB(name)
    return _DB


###############################################################################
# INTERVAL DB
###############################################################################

class IntervalDB(BaseDB):
    """Interval DB is a (key, interval, value) database."""

    ###########################################################################
    # DB
    ###########################################################################

    def sql_tables(self):
        """Define sql tables. Overridden by subclass."""
        return [(
            f"CREATE TABLE IF NOT EXISTS {self.table()} ("
            "chnl VARCHAR(128) NOT NULL,"
            "id VARCHAR(32) NOT NULL,"
            "low DOUBLE DEFAULT NULL,"
            "high DOUBLE DEFAULT NULL,"
            "lowClosed BOOLEAN DEFAULT TRUE,"
            "highClosed BOOLEAN DEFAULT FALSE,"
            "ctime TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),"
            "value VARCHAR(2048),"
            "PRIMARY KEY (chnl, id))"
        )]

    def sql_indexes(self):
        """Define sql indexes. Overridden by subclass."""
        return [
            f"CREATE INDEX idx_low ON {self.table()} (low)",
            f"CREATE INDEX idx_high ON {self.table()} (high)"
        ]

    ###########################################################################
    # ITEMS
    ###########################################################################

    def as_item(self, record):
        """Convert a database record to item."""
        chnl, key, low, high, lowClosed, highClosed, ctime, value = record
        if low == NEG_INF:
            low = None
        if high == POS_INF:
            high = None

        return {
            "key": key,
            "dim": (low, high, bool(lowClosed), bool(highClosed)),
            "val": json.loads(value)
        }

    ###########################################################################
    # INSERT
    ###########################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        return (
            f"INSERT INTO {self.table()} "
            "(chnl, id, low, high, lowClosed, highClosed, value) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "low=VALUES(low), "
            "high=VALUES(high), "
            "lowClosed=VALUES(lowClosed), "
            "highClosed=VALUES(highClosed), "
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
        if type(dim) in (int, float):
            dim = [dim]
        # dim is interval
        low, high, lowClosed, highClosed = check_interval(dim)
        if low is None:
            low = NEG_INF
            lowClosed = True
        if high is None:
            high = POS_INF
            highClosed = True
        value = json.dumps(item.get("val", None))
        return (chnl, key, low, high, lowClosed, highClosed, value)

    ###########################################################################
    # LOOKUP
    ###########################################################################

    def lookup_supported(self):
        """Lookup is supported."""
        return True

    def lookup_sql(self, chnl, interval, use_brackets=True):
        """Create SQL string for lookup."""
        A, B, _, _ = interval
        if A is None and B is None:
            return self.get_sql()
        elif A is None:
            return self._make_sql_left(chnl, interval,
                                       use_brackets=use_brackets)
        elif B is None:
            return self._make_sql_right(chnl, interval,
                                        use_brackets=use_brackets)
        else:
            return self._make_sql_regular(chnl, interval,
                                          use_brackets=use_brackets)

    def lookup_args(self, chnl, interval, use_brackets=True):
        """Create args for lookup SQL."""
        A, B, _, _ = interval
        if A is None and B is None:
            return self.get_args(chnl)
        elif A is None:
            return self._make_args_left(chnl, interval,
                                        use_brackets=use_brackets)
        elif B is None:
            return self._make_args_right(chnl, interval,
                                         use_brackets=use_brackets)
        else:
            return self._make_args_regular(chnl, interval,
                                           use_brackets=use_brackets)

    ###########################################################################
    # INTERNAL - LOOKUP
    ###########################################################################

    def _make_sql_left(self, chnl, interval, use_brackets=True):
        """Create SQL statement for interval which is left-unbound."""
        _, B, _, B_closed = interval
        SQL = (
            f"SELECT * FROM {self.table()} "
            "WHERE chnl=%s"
            "AND"
            "("
            "(low <= %s)"
            "OR"
            "(high <= %s)"
            ")"
        )
        if use_brackets:
            if B_closed:
                SQL += "AND NOT (low=%s AND lowClosed=0) "
            else:
                SQL += "AND NOT low=%s "
        return SQL

    def _make_args_left(self, chnl, interval, use_brackets=True):
        """Create args statement for interval which is left-unbound."""
        _, B, _, B_closed = interval
        args = [chnl, B, B]
        if use_brackets:
            args.append(B)
        return args

    def _make_sql_right(self, chnl, interval, use_brackets=True):
        """Create SQL statement for interval which is right-unbound."""
        A, _, A_closed, _ = interval
        SQL = (
            f"SELECT * FROM {self.table()} "
            "WHERE chnl=%s"
            "AND"
            "("
            "(low >= %s)"
            "OR"
            "(high >= %s)"
            ")"
        )
        if use_brackets:
            if A_closed:
                SQL += "AND NOT (high=%s AND highClosed=0) "
            else:
                SQL += "AND NOT high=%s "
        return SQL

    def _make_args_right(self, chnl, interval, use_brackets=True):
        """Create args statement for interval which is right-unbound."""
        A, _, A_closed, _ = interval
        args = [chnl, A, A]
        if use_brackets:
            args.append(A)
        return args

    def _make_sql_regular(self, chnl, interval, use_brackets=True):
        """Create SQL statement for lookup of regular interval."""
        A, B, A_closed, B_closed = interval
        SQL = (
            f"SELECT * FROM {self.table()} "
            "WHERE chnl=%s"
            "AND"
            "("
            "("
            "(low BETWEEN %s AND %s)"
            "OR"
            "(high BETWEEN %s AND %s)"
            ")"
            "OR (low <= %s AND %s <= high)"
            ")"
        )
        if use_brackets:

            # SQL += """
            # AND NOT (high=%s AND (highClosed=0 OR %s=0 ))
            # AND NOT (low=%s AND (lowClosed=0 OR %s=0 ))
            # """
            # args.extend([
            #     A, int(A_closed),
            #     B, int(B_closed)
            # ])

            if A_closed:
                SQL += " AND NOT (high=%s AND highClosed=0) "
            else:
                SQL += " AND NOT high=%s "
            if B_closed:
                SQL += " AND NOT (low=%s AND lowClosed=0) "
            else:
                SQL += " AND NOT low=%s "
        return SQL

    def _make_args_regular(self, chnl, interval, use_brackets=True):
        """Create args for lookup of regular interval."""
        A, B, A_closed, B_closed = interval
        args = [chnl, A, B, A, B, A, B]
        if use_brackets:
            args.append(A)
            args.append(B)
        return args
