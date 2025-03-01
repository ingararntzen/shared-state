from src.server.db_items import ItemsDB
from pathlib import PurePosixPath


class ItemsService:

    def __init__(self, config):
        self._db = ItemsDB(config)

    def get(self, path):
        n_path = PurePosixPath(path)
        chnl = n_path.parts[2]
        return True, list(self._db.get(chnl))

    def put(self, path, args):
        n_path = PurePosixPath(path)
        chnl = n_path.parts[2]
        return True, self._db.update(chnl, args)


def get_service(config):
    return ItemsService(config)
