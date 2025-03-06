"""Abstract base class for DataCannon Databases."""

import mysql.connector as MySQLdb
import threading
import time
from datetime import datetime, timezone
from itertools import chain


###############################################################################
# UTIL
###############################################################################

def batch(iterable, batch_size=1):
    """Make a batch generator function for an iterable."""
    tot = len(iterable)
    for ndx in range(0, tot, batch_size):
        yield iterable[ndx:min(ndx + batch_size, tot)]


def datetime_to_string(dt):
    """Convert datetime object to readable string."""
    return dt.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]


def utc_now_to_string():
    """Convert UTC NOW to readable string."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]


###########################################################################
# BASE DB
###########################################################################

class BaseDB:
    """Abstract base class for DataCannon Databases."""

    BATCH_SIZE = 1024

    def __init__(self, cfg, stop_event=None):
        """Construct Database."""
        self.cfg = {
            "ssl.enabled": False,
            "ssl.key": None,
            "ssl.ca": None,
            "ssl.cert": None
        }
        self.cfg.update(cfg)
        if stop_event:
            self.stop_event = stop_event
        else:
            self.stop_event = threading.Event()

    async def initialise(self);
        await self.init_pool()
        await self._prepare_tables()
        await self._prepare_indexes()

    def stop(self):
        """Stop the database."""
        self.stop_event.set()

    async def _execute(self, cur, statement, parameters=[]):
        """
        Run a SQL statement.
        On error - retry at most 2 times, one second apart
        """
        err = None
        for i in range(0, 3):
            if self.stop_event.is_set():
                break
            try:
                return await cur.execute(statement, parameters)
            except Exception as e:
                err = e
                print("Exception, retrying in 1 second", e.__class__, e)
                time.sleep(1)
        raise err

    async def _executemany(self, cur, statement, records):
        """Run a batch SQL statement."""
        if not records:
            return None
        err = None
        for i in range(0, 3):
            try:
                # not so important anymore, as batching is done
                # on a higher level anyway
                for record_batch in batch(records, self.BATCH_SIZE):
                    await c.executemany(statement, record_batch)
            except Exception as e:
                err = e
                print("Exception, retrying in 1 second", e.__class__, e)
                time.sleep(1)
        raise err

    async def _prepare_tables(self):
        """Create database tables if not exists."""
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                for sql in self.sql_tables():
                    # if table not in existing_tables:
                    self._execute(cur, sql)

    async def _prepare_indexes(self):
        """Create database indexes if not exists."""
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                for index in self.sql_indexes():
                    try:                        
                        cur.execute(index)
                    except (MySQLdb.errors.ProgrammingError) as e:
                        if e.errno == 1061 and e.msg.startswith("Duplicate key name"):
                            # index already exists
                            pass
                        else:
                            raise e

    #######################################################################
    # PUBLIC METHODS
    #######################################################################


    def table(self):
        """Return table name."""
        return self.cfg["db_table"]

    async def cursor_to_items(self, cur):
        """
        Make batch of items from database cursor.

        Generator function based on batch-size.
        """
        while True:
            rows = await cur.fetchall(self.BATCH_SIZE)
            if not rows:
                break
            yield [self.as_item(row) for row in row]

    async def get(self, app, chnl):
        """
        Return all items from (app,channel).

        Generator function yielding batch_size batches
        """
        SQL = self.get_sql()
        args = self.get_sql_args(app, chnl)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                async for items in self.cursor_to_items(cur):
                    yield items
        
    async def get_all(self, app, chnl):
        """
        Convenience - return an iteable which is flat
        i.e. can be turned into flat list with list()
        """
        return await chain.from_iterable(self.get(app, chnl))

    async def insert(self, app, chnl, items):
        """
        Insert/replace items in (app, chnl).

        Items must be structured as results from get()
        Return number of affected rows.

        Operation is batched within executemany.
        """

        # check input
        if not isinstance(app, str):
            print("db insert: app must be string", app, type(app))
            return []
        if not isinstance(chnl, str):
            print("db insert: chnl must be string", chnl, type(chnl))
            return []
        if not items:
            return []
        # support single item
        if not isinstance(items, list):
            items = [items]

        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                # SQL
                SQL = self.insert_sql()
                records = []
                for item in items:
                    rec = self.insert_sql_args(app, chnl, item)
                    if rec is None:
                        # drop empty records
                        continue
                    records.append(rec)
                await self._executemany(cur, SQL, records)
                return items

    async def remove(self, app, chnl, ids):
        """
        Remove items with given ids from (app, chnl).

        Batch calls to execute.
        """
        # check input
        if not isinstance(app, str):
            print("db remove: app must be string", app, type(app))
            return []
        if not isinstance(chnl, str):
            print("db remove: chnl must be string", chnl, type(chnl))
            return []
        if not ids:
            return []
        # support single id
        if not isinstance(ids, list):
            ids = [ids]

        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:        
                # batch operation
                for id_batch in batch(ids, batch_size=BaseDB.BATCH_SIZE):
                    SQL = self.remove_sql(id_batch)
                    args = self.remove_sql_args(app, chnl, id_batch)
                    await self._execute(cur, SQL, args)                    
                    return ids

    async def delete(self, app, chnl):
        """
        Remove all items of (app, chnl).
        Return list of removed items.
        """
        SQL = self.delete_sql()
        args = self.delete_sql_args(app, chnl)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                    return cur.rowcount

    async def apps(self):
        """
        Get all unique apps in database
        Returns entire result as list - not batch generator
        """
        SQL = self.apps_sql()
        args = self.apps_sql_args()
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                row = await cur.fetchall()
                return [row[0] for row in await cur.fetchall()]

    async def channels(self, app):
        """
        Get all unique channels of app.
        Returns entire result as list - not batch generator
        """
        SQL = self.channels_sql()
        args = self.channels_sql_args(app)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                row = await cur.fetchall()
                return [row[0] for row in await cur.fetchall()]

    def timestamp(self):
        """Return timestamp of database."""
        return utc_now_to_string()

    ###########################################################################
    # OVERRIDE METHODS
    ###########################################################################

    def sql_tables(self):
        """Define sql tables. Overridden by subclass."""
        raise NotImplementedError()

    def sql_indexes(self):
        """Define sql indexes. Overridden by subclass."""
        raise NotImplementedError()
