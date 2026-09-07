from sharedstate.db_mysql import MysqlDB
from sharedstate.db_sqlite import SqliteDB


class ItemsStore:

    def __init__(self, config):
        if config["db_type"] == "mysql":
            self._db = MysqlDB(config)
        elif config["db_type"] == "sqlite":
            self._db = SqliteDB(config)
        self._versions = {}

    # namespace methods
    async def apps(self):
        return await self._db.apps()

    async def resources(self, app):
        return await self._db.resources(app)

    # lifecycle methods
    async def open(self):
        await self._db.open()

    async def close(self):
        await self._db.close()

    # resource methods
    async def get(self, app, resource):
        return await self._db.get_all(app, resource)

    async def get_version(self, app, resource):
        key = (app, resource)
        return self._versions.get(key, 0)

    async def update(self, app, resource, changes):
        key = (app, resource)
        current_version = self._versions.get(key, 0)
        last_version = changes.get("last_version")

        if last_version is not None and last_version != current_version:
            return False, {
                "error": "VERSION_MISMATCH",
                "current_version": current_version
            }

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

        new_version = current_version + 1
        self._versions[key] = new_version

        return True, {
            "remove": remove,
            "insert": insert,
            "reset": reset,
            "version": new_version
        }


def get_store(config):
    return ItemsStore(config)
