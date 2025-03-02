from src.server.db_items import ItemsDB


class ItemsService:

    def __init__(self, config):
        self._db = ItemsDB(config)

    def get(self, app, resource):
        return list(self._db.get_all(app, resource))

    def put(self, app, resource, args):
        return self._db.update(app, resource, args)


def get_service(config):
    return ItemsService(config)
