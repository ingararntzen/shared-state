import json
import aiosqlite


###############################################################################
# UTIL
###############################################################################

BATCH_SIZE = 1024


def batch(iterable, batch_size=1):
    """Make a batch generator function for an iterable."""
    tot = len(iterable)
    for ndx in range(0, tot, batch_size):
        yield iterable[ndx:min(ndx + batch_size, tot)]


def as_item(record):
    """Convert a database record to item."""
    app, chnl, id, ts, data = record
    return {
        "id": id,
        "data": json.loads(data)
    }


###############################################################################
# SQLITE ITEMS DB
###############################################################################

class SqliteDB:

    """
    Sqlite database

    Database for collection of items {"id": ..., "data": ...}
    """

    def __init__(self, cfg):
        self.db = None
        self.cfg = cfg
        self._table = self.cfg["db_table"]

    async def open(self):
        db_name = self.cfg.get("db_name", ":memory:")
        isolation_level = self.cfg.get("db_isolation_level", None)
        self.db = await aiosqlite.connect(db_name,
                                          isolation_level=isolation_level)
        await self._prepare_tables()

    async def close(self):
        if self.db:
            await self.db.close()
            self.db = None

    #######################################################################
    # INTERNAL METHODS
    #######################################################################

    async def _prepare_tables(self):
        """Create database tables if not exists."""
        SQL = (
            f"CREATE TABLE IF NOT EXISTS {self._table} ("
            "app TEXT NOT NULL,"
            "chnl TEXT NOT NULL,"
            "id TEXT NOT NULL,"
            "ctime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "data TEXT,"
            "PRIMARY KEY (app, chnl, id))"
        )
        await self.db.execute(SQL)

    async def _cursor_to_items(self, cur):
        """
        Make batch of items from database cursor.
        Generator function based on batch-size.
        """
        while True:
            rows = await cur.fetchmany(BATCH_SIZE)
            if not rows:
                break
            yield [as_item(row) for row in rows]

    def _check_input(self, app, chnl, items):
        if not isinstance(app, str):
            print("db remove: app must be string", app, type(app))
            return []
        if not isinstance(chnl, str):
            print("db remove: chnl must be string", chnl, type(chnl))
            return []
        if not items:
            return []
        # support single item
        if not isinstance(items, list):
            items = [items]
        return items

    #######################################################################
    # PUBLIC METHODS
    #######################################################################

    async def get(self, app, chnl):
        """
        Return all items from (app,channel).

        Generator function yielding batch_size batches
        """
        SQL = f"SELECT * FROM {self._table} WHERE app=? AND chnl=?"
        args = (app, chnl)
        async with self.db.execute(SQL, args) as cur:
            async for items in self._cursor_to_items(cur):
                yield items

    async def get_all(self, app, chnl):
        """
        Convenience - return an iterable which is flat
        i.e. can be turned into a flat list with list()
        """
        items = []
        async for batch in self.get(app, chnl):
            items.extend(batch)
        return items

    async def insert(self, app, chnl, items):
        """
        Insert/replace items in (app, chnl).

        Items must be structured as results from get()
        Return number of affected rows.

        Operation is batched within executemany.
        """
        items = self._check_input(app, chnl, items)
        if not items:
            return []
        SQL = (
            f"INSERT OR REPLACE INTO {self._table} "
            "(app, chnl, id, data) "
            "VALUES (?, ?, ?, ?)"
        )
        args = []
        for item in items:
            data = json.dumps(item.get("data", None))
            rec = (app, chnl, item["id"], data)
            if rec is None:
                # drop empty records
                continue
            args.append(rec)
        await self.db.executemany(SQL, args)
        return items

    async def remove(self, app, chnl, ids):
        """
        Delete items with given ids from (app, chnl).
        """
        ids = self._check_input(app, chnl, ids)
        if not ids:
            return []
        for id_batch in batch(ids, batch_size=BATCH_SIZE):
            id_args = ",".join(["?"] * len(id_batch))
            SQL = (
                f"DELETE FROM {self._table} "
                f"WHERE app=? AND chnl=? AND id IN ({id_args})"
            )
            args = (app, chnl,) + tuple(id_batch)
            await self.db.execute(SQL, args)
        return ids

    async def delete(self, app, chnl):
        """
        Delete all items of (app, chnl).
        Return list of removed items.
        """
        SQL = f"DELETE FROM {self._table} WHERE app=? AND chnl=?"
        args = (app, chnl)
        async with self.db.execute(SQL, args) as cur:
            await cur.close()
            return cur.rowcount

    async def apps(self):
        """
        Get all unique apps in database
        Returns entire result as list - not batch generator
        """
        SQL = f"SELECT DISTINCT app FROM {self._table}"
        args = ()
        async with self.db.execute(SQL, args) as cur:
            return [row[0] for row in await cur.fetchall()]

    async def channels(self, app):
        """
        Get all unique channels of app.
        Returns entire result as list - not batch generator
        """
        SQL = f"SELECT DISTINCT chnl FROM {self._table} WHERE app=?"
        args = (app,)
        async with self.db.execute(SQL, args) as cur:
            return [row[0] for row in await cur.fetchall()]
