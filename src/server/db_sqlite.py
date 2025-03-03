import sqlite3
import json
from src.server.db_base import BaseDB

###############################################################################
# IN-MEMORY ITEMS DB
###############################################################################

"""
Sqlite in-memory database

Database for collection of items {"id": ..., "data": ...}
"""


class SqliteDB(BaseDB):

    #######################################################################
    # TABLES
    #######################################################################

    def sql_tables(self):
        """Define sql tables."""
        return [(
            f"CREATE TABLE IF NOT EXISTS {self.table()} ("
            "app TEXT NOT NULL,"
            "chnl TEXT NOT NULL,"
            "id TEXT NOT NULL,"
            "ctime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "data TEXT,"
            "PRIMARY KEY (app, chnl, id))"
        )]

    #######################################################################
    # INDEXES
    #######################################################################

    def sql_indexes(self):
        """Define sql indexes. No additional indexes."""
        return []

    #######################################################################
    # CONNECTION
    #######################################################################

    def get_conn(self):
        """Create database connection if not exists."""
        if not self.conn:
            self.conn = sqlite3.connect(":memory:")
        return self.conn

    #######################################################################
    # ITEMS
    #######################################################################

    def as_item(self, record):
        """Convert a database record to item."""
        app, chnl, id, ts, data = record
        return {
            "id": id,
            # "ts": datetime_to_string(ts),
            "data": json.loads(data)
        }

    #######################################################################
    # APPS SQL
    #######################################################################

    def apps_sql(self):
        """Create SQL string for getting apps."""
        return f"SELECT DISTINCT app FROM {self.table()}"

    def apps_sql_args(self):
        return ()

    #######################################################################
    # CHANNELS SQL
    #######################################################################

    def channels_sql(self):
        """Create SQL string for getting channels of app."""
        return f"SELECT DISTINCT chnl FROM {self.table()} WHERE app=?"

    def channels_sql_args(self, app):
        return (app,)

    #######################################################################
    # GET SQL
    #######################################################################

    def get_sql(self):
        """Create SQL string fro get."""
        return f"SELECT * FROM {self.table()} WHERE app=? AND chnl=?"

    def get_sql_args(self, app, chnl):
        """Create args for get SQL statement."""
        return (app, chnl)

    #######################################################################
    # INSERT SQL
    #######################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        return (
            f"INSERT OR REPLACE INTO {self.table()} "
            "(app, chnl, id, data) "
            "VALUES (?, ?, ?, ?)"
        )

    def insert_sql_args(self, app, chnl, item):
        """Create args for insert SQL statement."""
        data = json.dumps(item.get("data", None))
        return (app, chnl, item["id"], data)

    #######################################################################
    # REMOVE SQL
    #######################################################################

    def remove_sql(self, ids):
        """Create SQL string from remove"""
        id_args = ",".join(["?"] * len(ids))
        return (
            f"DELETE FROM {self.table()} "
            f"WHERE app=? AND chnl=? AND id IN ({id_args})"
        )

    def remove_sql_args(self, app, chnl, ids):
        return (app, chnl,) + tuple(ids)

    #######################################################################
    # DELETE SQL
    #######################################################################

    def delete_sql(self):
        return f"DELETE FROM {self.table()} WHERE app=? AND chnl=?"

    def delete_sql_args(self, app, chnl):
        return (app, chnl)
