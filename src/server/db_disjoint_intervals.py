"""
Database for storing channels of items.

Each channel is a set of tracks.
Each track is a set of non-overlapping items.
"""

from src.server.db_intervals import IntervalDB
import src.server.intervals as intervals

###############################################################################
# DB SINGLETON
###############################################################################

_DB = None


def getDB(name="disjoint_intervals"):
    """Return database singleton."""
    global _DB
    if not _DB:
        _DB = DisjointIntervalDB(name)
    return _DB


###############################################################################
# DISJOINT INTERVAL DB
###############################################################################

class DisjointIntervalDB(IntervalDB):
    """
    Database for storing channels of (key, interval, value) items.

    Value assumed to contain "track" field - identifying specific
    track within channel.

    Intervals are guaranteed to be disjunct (i.e. non-overlapping)
    within a single track.

    Default track is "".
    """

    def insert(self, chnl, items):
        """
        Override insert method of IntervalDB.

        Check if inserted items intersect any pre-existing intervals,
        within same track.
        If so, remove or truncate existing interval to make
        room for new items.

        """
        cache = {}

        for new_item in items:
            if "dim" not in new_item:
                # drop non-interval items
                continue

            # track sensitive
            track = None
            if isinstance(new_item["val"], dict) and "track" in new_item["val"]:
                track = new_item["val"]["track"]

            for batch in self.lookup(chnl, new_item["dim"]):
                # find candidates for overlap comparison
                # results from database are potentially
                # "overridden" by the local cache
                # also - some items may exist only in cache
                # and not in the database

                # items from database which are not in cache
                candidates = [item for item in batch if item["key"] not in cache]
                # items from cache, except those marked as removed
                candidates.extend([item for item in cache.values() if item is not None])

                # process candidates
                for old_item in candidates:
                    if track is not None:
                        _track = old_item["val"]["track"]
                        if _track != track:
                            continue
                    # overlay insert interval
                    op, left, right = intervals.overlay(old_item["dim"],
                                                        new_item["dim"])
                    if op == "drop":
                        # drop old interval
                        cache[old_item["key"]] = None
                    elif op == "trunc":
                        # truncate old interval
                        if left is not None:
                            # trunc left
                            old_item["dim"] = left
                            cache[old_item["key"]] = old_item
                        elif right is not None:
                            # trunc right
                            old_item["dim"] = right
                            cache[old_item["key"]] = old_item
            # insert new item
            cache[new_item["key"]] = new_item

        # update database
        remove_keys = [key for key, item in cache.items() if item is None]
        insert_items = [item for item in cache.values() if item is not None]
        res = super().remove(chnl, remove_keys)
        res.extend(super().insert(chnl, insert_items))
        return res

    def update_is_absolute(self):
        """Return True if DB updates are absolute."""
        return False
