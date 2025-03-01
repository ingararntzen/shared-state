"""Database for (key, value) items."""

import json
from src.server.db_base import BaseDB


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
        if self.cfg["db_type"] == "mysql":
            return [(
                f"CREATE TABLE IF NOT EXISTS {self.table()} ("
                "app VARCHAR(128) NOT NULL,"
                "chnl VARCHAR(128) NOT NULL,"
                "id VARCHAR(64) NOT NULL,"
                "ctime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
                "data TEXT,"
                "PRIMARY KEY (app, chnl, id))"
            )]
        elif self.cfg["db_type"] == "sqlite":
            return [(
                f"CREATE TABLE IF NOT EXISTS {self.table()} ("
                "app TEXT NOT NULL,"
                "chnl TEXT NOT NULL,"
                "id TEXT NOT NULL,"
                "ctime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
                "data TEXT,"
                "PRIMARY KEY (app, chnl, id))"
            )]

    def sql_indexes(self):
        """Define sql indexes. No additional indexes."""
        return []

    ###########################################################################
    # ITEMS
    ###########################################################################

    def as_item(self, record):
        """Convert a database record to item."""
        app, chnl, id, ts, data = record
        return {
            "id": id,
            # "ts": datetime_to_string(ts),
            "data": json.loads(data)
        }

    ###########################################################################
    # APPS SQL
    ###########################################################################

    def apps_sql(self):
        """Create SQL string for getting apps."""
        return f"SELECT DISTINCT app FROM {self.table()}"

    def apps_sql_args(self):
        return ()

    ###########################################################################
    # CHANNELS SQL
    ###########################################################################

    def channels_sql(self):
        """Create SQL string for getting channels of app."""
        s = self.sql_var_symbol()
        return f"SELECT DISTINCT chnl FROM {self.table()} WHERE app={s}"

    def channels_sql_args(self, app):
        return (app,)

    ###########################################################################
    # GET SQL
    ###########################################################################

    def get_sql(self):
        """Create SQL string fro get."""
        s = self.sql_var_symbol()
        return f"SELECT * FROM {self.table()} WHERE app={s} AND chnl={s}"

    def get_sql_args(self, app, chnl):
        """Create args for get SQL statement."""
        return (app, chnl)

    ###########################################################################
    # INSERT SQL
    ###########################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        if self.cfg["db_type"] == "mysql":
            return (
                f"INSERT INTO {self.table()} "
                "(app, chnl, id, data) "
                "VALUES (%s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE "
                "data = VALUES(data)"
            )
        elif self.cfg["db_type"] == "sqlite":
            return (
                f"INSERT OR REPLACE INTO {self.table()} "
                "(app, chnl, id, data) "
                "VALUES (?, ?, ?, ?)"
            )

    def insert_sql_args(self, app, chnl, item):
        """Create args for insert SQL statement."""
        data = json.dumps(item.get("data", None))
        return (app, chnl, item["id"], data)

    ###########################################################################
    # REMOVE SQL
    ###########################################################################

    def remove_sql(self, ids):
        """Create SQL string from remove"""
        s = self.sql_var_symbol()
        id_args = ",".join([s] * len(ids))
        return (
            f"DELETE FROM {self.table()} "
            f"WHERE app={s} AND chnl={s} AND id IN ({id_args})"
        )

    def remove_sql_args(self, app, chnl, ids):
        return (app, chnl,) + tuple(ids)

    ###########################################################################
    # DELETE SQL
    ###########################################################################

    def delete_sql(self):
        s = self.sql_var_symbol()
        return f"DELETE FROM {self.table()} WHERE app={s} AND chnl={s}"

    def delete_sql_args(self, app, chnl):
        return (app, chnl)
