from src.server.db_items import ItemsDB
from pathlib import PurePosixPath


class ItemsService:

    def __init__(self, config):
        self._db = ItemsDB(config)

    def get(self, path):
        n_path = PurePosixPath(path)
        app = n_path.parts[2]
        chnl = n_path.parts[3]
        return True, list(self._db.get(app, chnl))

    def put(self, path, items):
        n_path = PurePosixPath(path)
        app = n_path.parts[2]
        chnl = n_path.parts[3]
        return True, self._db.update(app, chnl, items)


def get_service(config):
    return ItemsService(config)
