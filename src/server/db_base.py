"""Abstract base class for DataCannon Databases."""

import mysql.connector as MySQLdb
import sqlite3
import threading
import time
import datetime


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
    return datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]


###############################################################################
# BASE DB
###############################################################################

class BaseDB:
    """Abstract base class for DataCannon Databases."""

    BATCH_SIZE = 1024

    def __init__(self, cfg, stop_event=None):
        """Construct Database."""
        self.conn = None
        self.cfg = cfg
        self.cfg.update({
            "ssl.enabled": False,
            "ssl.key": None,
            "ssl.ca": None,
            "ssl.cert": None
        })
        if stop_event:
            self.stop_event = stop_event
        else:
            self.stop_event = threading.Event()

        self._prepare_tables()
        self._prepare_indexes()

    def stop(self):
        """Stop the database."""
        self.stop_event.set()

    def _get_conn(self):
        """Create database connection if not exists."""
        if not self.conn:
            if self.cfg["db_type"] == "mysql":
                try:
                    if self.cfg["ssl.enabled"]:
                        self.conn = MySQLdb.MySQLConnection(
                            host=self.cfg["db_host"],
                            user=self.cfg["db_user"],
                            passwd=self.cfg["db_password"],
                            db=self.cfg["db_name"],
                            use_unicode=True,
                            autocommit=True,
                            charset="utf8",
                            ssl_key=self.cfg["ssl.key"],
                            ssl_ca=self.cfg["ssl.ca"],
                            ssl_cert=self.cfg["ssl.cert"]
                        )
                    else:
                        self.conn = MySQLdb.MySQLConnection(
                            host=self.cfg["db_host"],
                            user=self.cfg["db_user"],
                            passwd=self.cfg["db_password"],
                            db=self.cfg["db_name"],
                            use_unicode=True,
                            autocommit=True,
                            charset="utf8")
                except Exception as e:
                    print("Failed to connect", e.__class__, e)
                    return None
            elif self.cfg["db_type"] == "sqlite":
                self.conn = sqlite3.connect(":memory:")
        return self.conn

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
                c = self._get_conn().cursor()
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
                c = self._get_conn().cursor()
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
                c = self._get_conn().cursor()
                c.execute(index)
            except (MySQLdb.errors.ProgrammingError) as e:
                if e.errno == 1061 and e.msg.startswith("Duplicate key name"):
                    # index already exists
                    pass
                else:
                    raise e

    ###########################################################################
    # PUBLIC METHODS
    ###########################################################################

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

    def get(self, chnl):
        """
        Return all items of channel.

        Generator function yielding batch_size batches
        """
        SQL = self.get_sql()
        args = self.get_args(chnl)
        c = self._execute(SQL, args)
        for items in self.cursor_to_items(c):
            yield items
        c.close()

    def insert(self, chnl, items):
        """
        Insert/replace items in channel.

        Items must be structured as results from get()
        Return number of affected rows.

        Operation is batched within executemany.
        """
        # check input
        if not isinstance(chnl, str):
            print("db insert: chnl must be string", chnl)
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
            rec = self.insert_args(chnl, item)
            if rec is None:
                # drop empty records
                continue
            records.append(rec)
        c = self._executemany(SQL, records)
        if c is not None:
            c.close()
        return items

    def remove(self, chnl, keys):
        """
        Remove items with given keys from channel.

        Batch calls to execute.
        """
        # check input
        if not isinstance(chnl, str):
            print("db remove: chnl must be string", chnl, type(chnl))
            return []
        if not keys:
            return []
        # support single key
        if not isinstance(keys, list):
            keys = [keys]
        # batch operation
        for key_batch in batch(keys, batch_size=BaseDB.BATCH_SIZE):
            key_args = ",".join(["%s"] * len(key_batch))
            SQL = (
                f"DELETE FROM {self.table()} "
                f"WHERE chnl=%s AND id IN ({key_args})"
            )
            args = (chnl,) + tuple(key_batch)
            c = self._execute(SQL, args)
            c.close()
        return [{"key": key} for key in keys]

    def update_is_absolute(self):
        """Return True if DB updates are absolute."""
        return True

    def update(self, chnl, items):
        """
        insert/remove items from channel.

        Convenience wrapper for processing inserts and removals as part
        of a single batch of operations.
        - remove: items which only specifies key
        - insert/replace: items which specify key + val
        - empty list : clear all
        """
        # support single item
        if not isinstance(items, list):
            items = [items]

        if len(items) == 0:
            return self.clear(chnl)

        removed_keys = set()
        keys_to_remove = set()
        items_to_insert = dict()

        # support commands if they are first item in batch
        # commands have a type field
        if "cmd" in items[0]:
            first = items.pop(0)
            if first["cmd"] == "clear_all":
                removed_keys = set([item["key"] for item in self.clear(chnl)])
            elif first["cmd"] == "clear_range":
                for batch in self.lookup(chnl, first["range"], use_brackets=True):
                    keys_to_remove.update([item["key"] for item in batch])

        # process rest of items
        for item in items:
            # no key -> drop
            if "key" not in item:
                print("warning: drop item with no key", item)
                continue
            key = item["key"]
            # key, but no value -> remove
            if "val" not in item:
                if key not in removed_keys:
                    keys_to_remove.add(key)
            # key and val -> insert
            else:
                removed_keys.discard(key)
                keys_to_remove.discard(key)
                items_to_insert[key] = item

        # perform operations
        res = [{"key": key} for key in removed_keys]
        res.extend(self.remove(chnl, list(keys_to_remove)))
        res.extend(self.insert(chnl, list(items_to_insert.values())))
        return res

    def lookup(self, chnl, interval, use_brackets=True):
        """
        Lookup items within interval.

        Return all items of channel, whose interval intersect the query
        interval.

        - <use_brackets> if true lookup is sensitive to brackets of search
          interval

        Note - performance issue in 3'rd prone if collection is large.
        """
        SQL = self.lookup_sql(chnl, interval, use_brackets=use_brackets)
        args = self.lookup_args(chnl, interval, use_brackets=use_brackets)
        c = self._execute(SQL, args)
        for batch in self.cursor_to_items(c):
            yield batch
        c.close()

    def clear(self, chnl):
        """
        Remove all items of channel.

        Return list of removed items.
        """
        items = []
        for batch in self.get(chnl):
            items.extend(batch)

        SQL = f"DELETE FROM {self.table()} WHERE chnl=%s"
        args = [chnl]

        c = self._execute(SQL, args)
        c.close()
        return [{"key": item["key"]} for item in items]

    def channels(self):
        """
        Get all unique chanels.

        Returns entire result as list - not batch generator
        """
        SQL = f"SELECT DISTINCT chnl FROM {self.table()}"
        c = self._execute(SQL)
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
        return []

    def sql_indexes(self):
        """Define sql indexes. Overridden by subclass."""
        raise NotImplementedError()
        return []

    def as_item(self, record):
        """Convert a database record to item."""
        raise NotImplementedError()
        return {}

    def get_sql(self):
        """Create SQL string fro get."""
        return f"SELECT * FROM {self.table()} WHERE chnl=%s"

    def get_args(self, chnl):
        """Create args for get SQL statement."""
        return [chnl]

    def insert_sql(self):
        """Create SQL string for insert."""
        raise NotImplementedError()
        return ""

    def insert_args(self, chnl, item):
        """Create args for insert SQL statement."""
        raise NotImplementedError()
        return ()

    def lookup_supported(self):
        """Lookup is supported."""
        return False

    def lookup_sql(self, chnl, interval, use_brackets=True):
        """
        Create SQL string for lookup.

        Ignore interval. Equivalent to get(chnl).
        """
        return self.get_sql()

    def lookup_args(self, chnl, interval, use_brackets=True):
        """
        Create args for lookup SQL.

        Ignore interval. Equivalent to get(chnl).
        """
        return self.get_args(chnl)
