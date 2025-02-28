import time


class ClockService:
    def get(self, path):
        return True, time.time()


def get_service(args):
    return ClockService()
