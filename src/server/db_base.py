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
        self.conn = None
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

        self._prepare_tables()
        self._prepare_indexes()

    def stop(self):
        """Stop the database."""
        self.stop_event.set()

    def _execute(self, statement, parameters=[]):
        """
        Run a SQL statement.

        On error - retry at most 2 times, one second apart
        """
        err = None
        for i in range(0, 3):
            if self.stop_event.is_set():
                break
            try:
                c = self.get_conn().cursor()
                c.execute(statement, parameters)
                return c
            except Exception as e:
                err = e
                self.conn = None
                print("Exception, retrying in 1 second", e.__class__, e)
                time.sleep(1)
        raise err

    def _executemany(self, statement, records):
        """Run a batch SQL statement."""
        if not records:
            return None
        err = None
        for i in range(0, 3):
            try:
                # not so important anymore, as batching is done
                # on a higher level anyway
                c = self.get_conn().cursor()
                for record_batch in batch(records, self.BATCH_SIZE):
                    c.executemany(statement, record_batch)
                return c
            except Exception as e:
                err = e
                self.conn = None
                print("Exception, retrying in 1 second", e.__class__, e)
                time.sleep(1)
        raise err

    def _prepare_tables(self):
        """Create database tables if not exists."""
        for sql in self.sql_tables():
            # if table not in existing_tables:
            self._execute(sql)

    def _prepare_indexes(self):
        """Create database indexes if not exists."""
        for index in self.sql_indexes():
            try:
                c = self.get_conn().cursor()
                c.execute(index)
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

    def cursor_to_items(self, cursor):
        """
        Make batch of items from database cursor.

        Generator function based on batch-size.
        """
        while True:
            items = []
            for tup in cursor.fetchmany(self.BATCH_SIZE):
                items.append(self.as_item(tup))
            if items:
                yield items
            else:
                break

    def get(self, app, chnl):
        """
        Return all items from (app,channel).

        Generator function yielding batch_size batches
        """
        SQL = self.get_sql()
        args = self.get_sql_args(app, chnl)
        c = self._execute(SQL, args)
        for items in self.cursor_to_items(c):
            yield items
        c.close()

    def get_all(self, app, chnl):
        """
        Convenience - return an iteable which is flat
        i.e. can be turned into flat list with list()
        """
        return chain.from_iterable(self.get(app, chnl))

    def insert(self, app, chnl, items):
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
        # SQL
        SQL = self.insert_sql()
        records = []
        for item in items:
            rec = self.insert_sql_args(app, chnl, item)
            if rec is None:
                # drop empty records
                continue
            records.append(rec)
        c = self._executemany(SQL, records)
        if c is not None:
            c.close()
        return items

    def remove(self, app, chnl, ids):
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
        # batch operation
        for id_batch in batch(ids, batch_size=BaseDB.BATCH_SIZE):
            SQL = self.remove_sql(id_batch)
            args = self.remove_sql_args(app, chnl, id_batch)
            c = self._execute(SQL, args)
            c.close()
        return ids

    def clear(self, app, chnl):
        """
        Remove all items of (app, chnl).
        Return list of removed items.
        """
        SQL = self.delete_sql()
        args = self.delete_sql_args(app, chnl)
        c = self._execute(SQL, args)
        rowcount = c.rowcount
        c.close()
        return rowcount

    def apps(self):
        """
        Get all unique apps in database
        Returns entire result as list - not batch generator
        """
        SQL = self.apps_sql()
        args = self.apps_sql_args()
        c = self._execute(SQL, args)
        res = [tup[0] for tup in c.fetchall()]
        c.close()
        return res

    def channels(self, app):
        """
        Get all unique channels of app.
        Returns entire result as list - not batch generator
        """
        SQL = self.channels_sql()
        args = self.channels_sql_args(app)
        c = self._execute(SQL, args)
        res = [tup[0] for tup in c.fetchall()]
        c.close()
        return res

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
