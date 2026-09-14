import os
import json
import aiomysql
import threading
import time
import warnings

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
    app, chnl, id, ts, json_data = record
    return json.loads(json_data)


def as_record(app, chnl, item):
    """Convert an item to a database record."""
    json_data = json.dumps(item)
    return (app, chnl, item["id"], json_data)


def resolve_config_val(val, fallback=None):
    """
    Resolves a configuration value:
    1. If val is an environment variable name (e.g. 'SHAREDSTATE_MYSQL_DB_USER') or '${VAR_NAME}',
       resolves it from os.environ.
    2. Converts boolean strings ('true'/'false') and 'none'/'null' to proper Python types.
    3. Returns fallback if an env var is specified but not found in os.environ.
    """
    if val is None:
        return fallback

    if isinstance(val, bool):
        return val

    if isinstance(val, str):
        raw = val.strip()
        env_key = raw
        is_explicit = False

        if env_key.startswith("${") and env_key.endswith("}"):
            env_key = env_key[2:-1].strip()
            is_explicit = True

        if env_key in os.environ:
            env_val = os.environ[env_key].strip()
            if env_val.lower() in ("true", "yes", "1"):
                return True
            if env_val.lower() in ("false", "no", "0"):
                return False
            if env_val.lower() in ("none", "null", ""):
                return None
            return env_val

        if is_explicit or env_key.startswith("SHAREDSTATE_") or (env_key.isupper() and "_" in env_key):
            return fallback

        if raw.lower() == "true":
            return True
        if raw.lower() == "false":
            return False

        return raw

    return val


###############################################################################
# MYSQL ITEMS DB
###############################################################################

class MysqlDB:
    """
    Mysql database

    Database for collection of items {"id":"unique_id", ...}
    "id" is string and unique within (app, chnl)
    Item as a whole must be serialized to JSON
    """

    def __init__(self, cfg, stop_event=None):
        self.cfg = {
            "ssl.enabled": False,
            "ssl.key": None,
            "ssl.ca": None,
            "ssl.cert": None
        }
        self.cfg.update(cfg)
        self._table = resolve_config_val(self.cfg.get("db_table"), fallback="items")
        if stop_event:
            self.stop_event = stop_event
        else:
            self.stop_event = threading.Event()

        # connection pool
        self.pool = None

    async def open(self):
        # db config
        db_host = resolve_config_val(self.cfg.get("db_host"), fallback="localhost")
        db_user = resolve_config_val(self.cfg.get("db_user"), fallback=None)
        db_password = resolve_config_val(self.cfg.get("db_password"), fallback=None)
        db_name = resolve_config_val(self.cfg.get("db_name"), fallback=None)
        ssl_enabled = resolve_config_val(self.cfg.get("ssl.enabled"), fallback=False)

        kwargs = dict(
            host=db_host,
            user=db_user,
            password=db_password,
            db=db_name,
            use_unicode=True,
            autocommit=True,
            charset="utf8",
            init_command="SET time_zone = '+00:00'",
        )
        # ssl config
        if ssl_enabled:
            ssl_key = resolve_config_val(self.cfg.get("ssl.key"), fallback=None)
            ssl_ca = resolve_config_val(self.cfg.get("ssl.ca"), fallback=None)
            ssl_cert = resolve_config_val(self.cfg.get("ssl.cert"), fallback=None)
            kwargs.update(
                dict(
                    ssl_key=ssl_key,
                    ssl_ca=ssl_ca,
                    ssl_cert=ssl_cert,
                )
            )
        # pool config
        kwargs.update(dict(
            minsize=self.cfg.get("db_pool_minsize", 1),
            maxsize=self.cfg.get("db_pool_maxsize", 5)
        ))
        self.pool = await aiomysql.create_pool(**kwargs)
        await self._prepare_tables()
        # figure out if db type is mariaDB or mysql
        db_version = await self._get_db_version()
        self.cfg["is_mariadb"] = "mariadb" in db_version.lower()

    async def close(self):
        """Close the connection pool properly."""
        if self.pool:
            self.pool.close()
            await self.pool.wait_closed()
            self.pool = None
        self.stop_event.set()

    #######################################################################
    # INTERNAL METHODS
    #######################################################################

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
        if err:
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
                for record_batch in batch(records, BATCH_SIZE):
                    await cur.executemany(statement, record_batch)
            except Exception as e:
                err = e
                print("Exception, retrying in 1 second", e.__class__, e)
                time.sleep(1)
        if err:
            raise err

    async def _prepare_tables(self):
        """Create database tables if not exists."""
        SQL = (
            f"CREATE TABLE IF NOT EXISTS {self._table} ("
            "app VARCHAR(128) NOT NULL,"
            "chnl VARCHAR(128) NOT NULL,"
            "id VARCHAR(64) NOT NULL,"
            "ctime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
            "data TEXT,"
            "PRIMARY KEY (app, chnl, id))"
        )
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                # if table not in existing_tables:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", aiomysql.Warning)
                    await self._execute(cur, SQL)

    async def _get_db_version(self):
        SQL = "SELECT VERSION()"
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(SQL)
                return (await cur.fetchone())[0]

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
        SQL = f"SELECT * FROM {self._table} WHERE app=%s AND chnl=%s"
        args = (app, chnl)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
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
        if self.cfg["is_mariadb"]:
            SQL = (
                f"INSERT INTO {self._table} "
                "(app, chnl, id, data) "
                "VALUES (%s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE "
                "data = VALUES(data)"
            )
        else:
            SQL = (
                f"INSERT INTO {self._table} "
                "(app, chnl, id, data) "
                "VALUES (%s, %s, %s, %s) AS new "
                "ON DUPLICATE KEY UPDATE "
                "data = new.data"
            )
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                args = []
                for item in items:
                    rec = as_record(app, chnl, item)
                    if rec is None:
                        # drop empty records
                        continue
                    args.append(rec)
                await self._executemany(cur, SQL, args)
                return items

    async def remove(self, app, chnl, ids):
        """
        Remove items with given ids from (app, chnl).

        Batch calls to execute.
        """
        ids = self._check_input(app, chnl, ids)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                # batch operation
                for id_batch in batch(ids, batch_size=BATCH_SIZE):
                    id_args = ",".join(["%s"] * len(ids))
                    SQL = (
                        f"DELETE FROM {self._table} "
                        f"WHERE app=%s AND chnl=%s AND id IN ({id_args})"
                    )
                    args = (app, chnl) + tuple(ids)
                    await self._execute(cur, SQL, args)
                    return ids

    async def delete(self, app, chnl):
        """
        Delete all items of (app, chnl).
        Return list of removed items.
        """
        SQL = f"DELETE FROM {self._table} WHERE app=%s AND chnl=%s"
        args = (app, chnl)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                return cur.rowcount

    async def apps(self):
        """
        Get all unique apps in database
        Returns entire result as list - not batch generator
        """
        SQL = f"SELECT DISTINCT app FROM {self._table}"
        args = ()
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                return [row[0] for row in await cur.fetchall()]

    async def resources(self, app):
        """
        Get all unique resources of app.
        Returns entire result as list - not batch generator
        """
        SQL = f"SELECT DISTINCT chnl FROM {self._table} WHERE app=%s"
        args = (app,)
        async with self.pool.acquire() as conn:
            async with conn.cursor() as cur:
                await self._execute(cur, SQL, args)
                return [row[0] for row in await cur.fetchall()]
