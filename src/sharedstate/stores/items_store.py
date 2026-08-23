from sharedstate.db_mysql import MysqlDB
from sharedstate.db_sqlite import SqliteDB


class ItemsStore:

    def __init__(self, config):
        if config["db_type"] == "mysql":
            self._db = MysqlDB(config)
        elif config["db_type"] == "sqlite":
            self._db = SqliteDB(config)

    async def open(self):
        await self._db.open()

    async def close(self):
        await self._db.close()

    async def get(self, app, resource):
        return await self._db.get_all(app, resource)

    async def apps(self):
        return await self._db.apps()

    async def channels(self, app):
        return await self._db.channels(app)

    async def update(self, app, resource, changes):
        insert = changes.get("insert", [])
        remove = changes.get("remove", [])
        reset = changes.get("reset", False)

        # update database
        if reset:
            await self._db.delete(app, resource)    
        else:
            if remove:
                await self._db.remove(app, resource, remove)
        if insert:
            await self._db.insert(app, resource, insert)

        return {
            "remove": remove,
            "insert": insert,
            "reset": reset
        }


def get_store(config):
    return ItemsStore(config)
