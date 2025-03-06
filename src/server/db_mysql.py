import mysql.connector as MySQLdb
from src.server.db_base import BaseDB
import json
import aiomysql

###############################################################################
# MYSQL ITEMS DB
###############################################################################

"""
Mysql database

Database for collection of items {"id": ..., "data": ...}
"""


class MysqlDB(BaseDB):


    def __init__(self, cfg, stop_event=None):
        super.__init__(self, cfg, stop_event=stop_event)

        self.pool = None


    #######################################################################
    # CONNECTION POOL
    #######################################################################

    async def init_pool(self);
        # db config
        kwargs = dict(
            host=self.cfg["db_host"],
            user=self.cfg["db_user"],
            passwd=self.cfg["db_password"],
            db=self.cfg["db_name"],
            use_unicode=True,
            autocommit=True,
            charset="utf8"
        )
        # ssl config
        if self.cfg["ssl.enabled"]:
            kwargs.update(dict(
                ssl_key=self.cfg["ssl.key"],
                ssl_ca=self.cfg["ssl.ca"],
                ssl_cert=self.cfg["ssl.cert"]
            ))
        # pool config
        kwargs.update(dict(
            minsize=1,
            maxsize=5
        )) 
        self.pool = await aiomysql.create_pool(**kwargs)
        print("pool created")


    async def close_pool(self):
        """Close the connection pool properly."""
        if self.pool:
            self.pool.close()
            await self.pool.wait_closed()
            print("✅ Connection pool closed.")


    #######################################################################
    # TABLES
    #######################################################################

    def sql_tables(self):
        """Define sql tables."""
        return [(
            f"CREATE TABLE IF NOT EXISTS {self.table()} ("
            "app VARCHAR(128) NOT NULL,"
            "chnl VARCHAR(128) NOT NULL,"
            "id VARCHAR(64) NOT NULL,"
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
            kwargs = dict(
                host=self.cfg["db_host"],
                user=self.cfg["db_user"],
                passwd=self.cfg["db_password"],
                db=self.cfg["db_name"],
                use_unicode=True,
                autocommit=True,
                charset="utf8"
            )
            if self.cfg["ssl.enabled"]:
                kwargs.update(dict(
                    ssl_key=self.cfg["ssl.key"],
                    ssl_ca=self.cfg["ssl.ca"],
                    ssl_cert=self.cfg["ssl.cert"]
                ))
            try:
                self.conn = MySQLdb.connect(**kwargs)
            except Exception as e:
                print("Failed to connect", e.__class__, e)
                return None
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
        return f"SELECT DISTINCT chnl FROM {self.table()} WHERE app=%s"

    def channels_sql_args(self, app):
        return (app,)

    #######################################################################
    # GET SQL
    #######################################################################

    def get_sql(self):
        """Create SQL string fro get."""
        return f"SELECT * FROM {self.table()} WHERE app=%s AND chnl=%s"

    def get_sql_args(self, app, chnl):
        """Create args for get SQL statement."""
        return (app, chnl)

    #######################################################################
    # INSERT SQL
    #######################################################################

    def insert_sql(self):
        """Create SQL string for insert."""
        return (
            f"INSERT INTO {self.table()} "
            "(app, chnl, id, data) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "data = VALUES(data)"
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
        id_args = ",".join(["%s"] * len(ids))
        return (
            f"DELETE FROM {self.table()} "
            f"WHERE app=%s AND chnl=%s AND id IN ({id_args})"
        )

    def remove_sql_args(self, app, chnl, ids):
        return (app, chnl,) + tuple(ids)

    #######################################################################
    # DELETE SQL
    #######################################################################

    def delete_sql(self):
        return f"DELETE FROM {self.table()} WHERE app=%s AND chnl=%s"

    def delete_sql_args(self, app, chnl):
        return (app, chnl)
