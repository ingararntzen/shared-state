from src.server.db_mysql import MysqlDB
from src.server.db_sqlite import SqliteDB
from collections import OrderedDict


class ItemsService:

    def __init__(self, config):
        if config["db_type"] == "mysql":
            self._db = MysqlDB(config)
        elif config["db_type"] == "sqlite":
            self._db = SqliteDB(config)
        # this service does not include old state in diffs
        self.oldstate_included = False

    def get(self, app, chnl):
        return list(self._db.get_all(app, chnl))

    def reset(self, app, chnl, insert_items):
        # clear
        self._db.clear(app, chnl)
        # insert
        self._db.insert(app, chnl, insert_items)
        return insert_items

    def update(self, app, chnl, changes):
        insert = changes.get("insert", [])
        remove = changes.get("remove", [])
        reset = changes.get("reset", False)

        # update database
        if reset:
            self._db.clear(app, chnl)    
        else:
            if remove:
                self._db.remove(app, chnl, remove)
        if insert:
            self._db.insert(app, chnl, insert)

        # diffs
        diffs = OrderedDict()
        if reset:
            # if reset flag is set - no information is incuded
            # about which items have been removed
            pass
        else:
            for _id in remove:
                diffs[_id] = {"id": _id, "new": None}
        for item in insert:
            diffs[item["id"]] = {"id": item["id"], "new": item}

        # return ordered list of diffs
        return list(diffs.values())


def get_service(config):
    return ItemsService(config)
