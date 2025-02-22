import functools

####################################################################
# ENDPOINTS
####################################################################


# Defining a positive infinite integer
POS_INF = float('inf')
NEG_INF = float('-inf')


class EndpointMode:
    RIGHT_OPEN = 0
    LEFT_CLOSED = 1
    LEFT_SINGULAR = 2
    RIGHT_SINGULAR = 3
    RIGHT_CLOSED = 4
    LEFT_OPEN = 5


def endpoint_value(endpoint):
    val, right = endpoint[0:2]
    if val is None:
        return POS_INF if right else NEG_INF
    return val


def endpoint_mode(endpoint):
    right, closed, singular = endpoint[1:4]
    if singular:
        if right:
            return EndpointMode.RIGHT_SINGULAR
        else:
            return EndpointMode.LEFT_SINGULAR
    if right:
        if closed:
            return EndpointMode.RIGHT_CLOSED
        else:
            return EndpointMode.RIGHT_OPEN
    else:
        if closed:
            return EndpointMode.LEFT_CLOSED
        else:
            return EndpointMode.LEFT_OPEN


def endpoint_dual(endpoint):
    """
    Return the dual endpoint.

    4) => [4
    (4 => 4]

    """
    val, right, closed, singular = endpoint
    return [val, not right, not closed, singular]


def endpoint_cmp(e1, e2):
    """
    given two endpoints e1, e2
    return -1, 0, 1

    -1 -> e1 less than e2
    0 : e1 equal to e2
    1: e1 greater than e2

    """

    o1 = endpoint_value(e1)
    o2 = endpoint_value(e2)
    if o1 != o2:
        # values are different => values define ordering
        diff = o1 - o2
    else:
        # values are the same => endpoint modes define ordering
        diff = endpoint_mode(e1) - endpoint_mode(e2)
    if diff == 0:
        return 0
    else:
        return 1 if diff > 0 else -1


def endpoint_lt(e1, e2):
    return endpoint_cmp(e1, e2) < 0


def endpoint_gt(e1, e2):
    return endpoint_cmp(e1, e2) > 0


def endpoint_min(e1, e2):
    return e1 if endpoint_cmp(e1, e2) <= 0 else e2


def endpoint_max(e1, e2):
    return e1 if endpoint_cmp(e1, e2) >= 0 else e2


####################################################################
# INTERVAL REPRESENTATION
# endpoints : [
#   [low, lowRight (False), lowClosed],
#   [high, highRigh (True), highClosed]
# ]
# interval: [low, high, lowClosed, highClosed]
####################################################################


def interval_as_endpoints(itv):
    """
    create endpoint pair from interval
    """
    low, high, lowClosed, highClosed = itv

    # support NONE as INFINITY values, because None is JSON serializable
    # since None is used both for -INF and INF, there is no way
    # discriminate [-INF, INF] from [-INF, -INF], [INF, INF] - or even
    # [INF, -INF] for this reason positioning defines [-INF, ...] and
    # [..., INF] as a consequence - singulars with infinity values are
    # not representable

    if low is None:
        eLow = [None, False, True, False]
    else:
        eLow = [low, False, lowClosed, False]
    if high is None:
        eHigh = [None, True, True, False]
    else:
        eHigh = [high, True, highClosed, False]

    if low is None or high is None:
        return [eLow, eHigh]

    if low == high:
        # singular
        eLow = [low, False, True, True]
        eHigh = [low, True, True, True]
    else:
        if low > high:
            raise Exception("low larger than high", low, high)

    return [eLow, eHigh]


def intervals_as_endpoints(intervals):
    """
    turns list of intervals into a sequence of endpoints,
    alternating low, high, low, ...
    """
    res = []
    for itv in intervals:
        res.extend(interval_as_endpoints(itv))
    return res


def interval_from_endpoints(eLow, eHigh, strict=False):
    """
    create interval from two endpoints if possible
    eHigh must be larger or equal to eLow
    endpoint dual used to turn endpoints the right way
    illegal variants of singular (],[),() yields no result
    """

    # deal with infinite values first
    eLow_value, eLow_right, eLow_closed, eLow_singular = eLow
    eHigh_value, eHigh_right, eHigh_closed, eHigh_singular = eHigh

    # make sure inf endpoints are closed
    if eLow_value is None:
        eLow_closed = True
    if eHigh_value is None:
        eHigh_closed = True

    # intervals with inifity values can not be singular
    if eLow_value is None or eHigh_value is None:
        return [eLow_value, eHigh_value, eLow_closed, eHigh_closed]

    if strict:

        # turn endpoints if necessary
        if (eLow[1] is True):
            eLow = endpoint_dual(eLow)
        if (eHigh[1] is False):
            eHigh = endpoint_dual(eHigh)

        eLow_value, eLow_right, eLow_closed, eLow_singular = eLow
        eHigh_value, eHigh_right, eHigh_closed, eHigh_singular = eHigh

        if eLow_value == eHigh_value:
            if [eLow_closed, eHigh_closed] == [True, True]:
                return [eLow_value, eLow_value, True, True]
            else:
                # illegal singular
                return
        elif eLow_value < eHigh_value:
            return [eLow_value, eHigh_value, eLow_closed, eHigh_closed]
        else:
            # wrong ordering
            return

    else:
        # just make an interval
        if eLow_value == eHigh_value:
            return [eLow_value, eLow_value, True, True]
        elif eLow_value < eHigh_value:
            return [eLow_value, eHigh_value, eLow_closed, eHigh_closed]
        else:
            return [eHigh_value, eLow_value, eHigh_closed, eLow_closed]


def intervals_from_endpoints(endpoints):
    """
    turns sequence of endpoints (alternating low, high, low, ...)
    endpoint list length must be even
    into sequence of intervals
    """
    if len(endpoints) % 2:
        e = "length of given endpoint sequence must be even"
        raise Exception(e, len(endpoints))
    res = []
    for i in range(0, len(endpoints), 2):
        res.append(interval_from_endpoints(endpoints[i], endpoints[i+1]))
    return res


####################################################################
# INTERVAL SORT
####################################################################

def sort(intervals):
    """
    sort intervals by low endpoint
    """
    def cmp(a, b):
        endpointLow_a, _ = interval_as_endpoints(a)
        endpointLow_b, _ = interval_as_endpoints(b)
        return endpoint_cmp(endpointLow_a, endpointLow_b)

    # sort intervals by low endpoint
    return sorted(intervals, key=functools.cmp_to_key(cmp))


####################################################################
# INTERVAL COMPARISON
####################################################################

class IntervalRelation:

    OUTSIDE_LEFT = 64   # 0b1000000
    OVERLAP_LEFT = 32   # 0b0100000
    COVERED = 16        # 0b0010000
    EQUALS = 8          # 0b0001000
    COVERS = 4          # 0b0000100
    OVERLAP_RIGHT = 2   # 0b0000010
    OUTSIDE_RIGHT = 1   # 0b0000001


def compare(a, b):
    """
    Compare two intervals and return IntervalRelation

    compares interval a to interval b
    e.g. return value COVERED reads a is covered by b.

    cmp_1 = endpoint_compare(b_low, a_low);
    cmp_2 = endpoint_compare(b_high, a_high);

    key = 10*cmp_1 + cmp_2

    cmp_1  cmp_2  key  relation
    =====  =====  ===  ============================
    -1     -1     -11  OUTSIDE_LEFT, PARTIAL_LEFT
    -1     0      -10  COVERS
    -1     1       -9  COVERS
    0      -1      -1  COVERED
    0      0        0  EQUAL
    0      1        1  COVERS
    1      -1       9  COVERED
    1      0       10  COVERED
    1      1       11  OUTSIDE_RIGHT, OVERLAP_RIGHT
    =====  =====  ===  ============================
    """

    eLow_a, eHigh_a = interval_as_endpoints(a)
    eLow_b, eHigh_b = interval_as_endpoints(b)
    cmp_1 = endpoint_cmp(eLow_a, eLow_b)
    cmp_2 = endpoint_cmp(eHigh_a, eHigh_b)
    key = cmp_1*10 + cmp_2
    if (key == 11):
        # OUTSIDE_RIGHT or OVERLAP_RIGHT
        if endpoint_lt(eHigh_b, eLow_a):
            return IntervalRelation.OUTSIDE_RIGHT
        else:
            return IntervalRelation.OVERLAP_RIGHT
    elif key in [-1, 9, 10]:
        return IntervalRelation.COVERED
    elif key in [1, -9, -10]:
        return IntervalRelation.COVERS
    elif key == 0:
        return IntervalRelation.EQUALS
    else:
        # OUTSIDE_LEFT or OVERLAP_LEFT
        if endpoint_gt(eLow_b, eHigh_a):
            return IntervalRelation.OUTSIDE_LEFT
        else:
            return IntervalRelation.OVERLAP_LEFT


####################################################################
# INTERVAL OVERLAY
####################################################################

def overlay(a, b):
    """
    Overlay interval b over interval a.

    If a and b overlaps, a is truncated
    so that a and be are not overlapping.

    Return (op, left, right)

    op
        "keep" - keep a - no overlap
        "drop" - drop a - b completely overlays a
        "trunc" - a was truncated into two intervals: left and right
    left and right
        None - empty interval
    """
    Rel = IntervalRelation
    rel = compare(a, b)
    if rel in [Rel.OUTSIDE_LEFT, Rel.OUTSIDE_RIGHT]:
        # keep A
        return ("keep", None, None)
    elif rel in [Rel.COVERED, Rel.EQUALS]:
        # drop A
        return ("drop", None, None)

    a_eLow, a_eHigh = interval_as_endpoints(a)
    b_eLow, b_eHigh = interval_as_endpoints(b)
    left, right = [None, None]
    # save left part of a
    if rel in [Rel.OVERLAP_LEFT, Rel.COVERS]:
        _a_eHigh = endpoint_dual(b_eLow)
        left = interval_from_endpoints(a_eLow, _a_eHigh, strict=True)
    # save right part of a
    if rel in [Rel.OVERLAP_RIGHT, Rel.COVERS]:
        _a_eLow = endpoint_dual(b_eHigh)
        right = interval_from_endpoints(_a_eLow, a_eHigh, strict=True)
    if (left is None and right is None):
        # think this is not reachable
        # should mean equality
        return ("drop", None, None)
    return ("trunc", left, right)


####################################################################
# INTERVAL UNION
####################################################################

def _union(a, b):
    """
    union of two intervals
    returns list of intervals
    collapsing adjacent intervals
    """
    aLow, aHigh, aLowClosed, aHighClosed = a
    bLow, bHigh, bLowClosed, bHighClosed = b
    endpointLow_a, endpointHigh_a = interval_as_endpoints(a)
    endpointLow_b, endpointHigh_b = interval_as_endpoints(b)
    rel = compare(a, b)
    if rel == IntervalRelation.OUTSIDE_LEFT:
        # merge in three cases
        # - [...,aHigh)[bLow, ...]
        # - [...,aHigh](bLow, ...]
        if aHigh != bLow or (not aHighClosed and not bLowClosed):
            # no merge
            return [a, b]
        else:
            # merge
            return [interval_from_endpoints(endpointLow_a, endpointHigh_b)]
    elif rel == IntervalRelation.OVERLAP_LEFT:
        # merge
        return [interval_from_endpoints(endpointLow_a, endpointHigh_b)]
    elif rel == IntervalRelation.COVERS:
        return [a]
    elif rel == IntervalRelation.EQUALS:
        return [a]  # or [b]
    elif rel == IntervalRelation.COVERED:
        return [b]
    elif rel == IntervalRelation.OVERLAP_RIGHT:
        # merge
        return [interval_from_endpoints(endpointLow_b, endpointHigh_a)]
    elif rel == IntervalRelation.OUTSIDE_RIGHT:
        # merge in two cases
        # - [...,bHigh)[aLow, ...]
        # - [...,bHigh](aLow, ...]
        if bHigh != aLow or (not bHighClosed and not aLowClosed):
            # no merge
            return [b, a]
        else:
            # merge
            return [interval_from_endpoints(endpointLow_b, endpointHigh_a)]


####################################################################
# INTERVAL NORMALISE
####################################################################

def normalise(intervals):
    """
    normalises a set of intervals
    - sort by low
    - collapse any overlapping intervals
    - returns sorted set of non-overlapping and non-adjacent intervals
      covering all points covered by at least one input interval
    """
    if len(intervals) == 0:
        return []
    if len(intervals) == 1:
        return intervals
    intervals = sort(intervals)
    result = [intervals.pop(0)]
    while len(intervals) > 0:
        _prev = result.pop(-1)
        _next = intervals.pop(0)
        result.extend(_union(_prev, _next))
    return result


####################################################################
# INTERVAL SET MERGE
####################################################################

def _merge(a_intervals, b_intervals, op):

    """
    Merge two sets of intervals.

    Internal helper function for set_union, set_intersect and
    set_difference functions for intervals.

    Traverses two lists of endpoints to select the next op
    (union|difference|intersect) specializes decision to include
    endpoints in result

    Algorithm based on solution for a simpler model where intervals are
    always [a,b)

    https://stackoverflow.com/questions/20060090/difference-of-two-sets-of-intervals
    """

    a_intervals = normalise(a_intervals)
    b_intervals = normalise(b_intervals)
    a_endpoints = intervals_as_endpoints(a_intervals)
    b_endpoints = intervals_as_endpoints(b_intervals)
    sentinel = None
    a_endpoints.append(sentinel)
    b_endpoints.append(sentinel)
    a_index = 0
    b_index = 0
    res = []

    scan = endpoint_min(a_endpoints[0], b_endpoints[0])
    while scan is not None:
        a = a_endpoints[a_index]
        b = b_endpoints[b_index]
        if a is None and b is None:
            break

        if a is None:
            scan_from_a = False
            in_a = False
        else:
            scan_from_a = (endpoint_cmp(scan, a) == 0)
            in_a = not ((endpoint_lt(scan, a)) ^ (a_index % 2))

        if b is None:
            scan_from_b = False
            in_b = False
        else:
            scan_from_b = (endpoint_cmp(scan, b) == 0)
            in_b = not ((endpoint_lt(scan, b)) ^ (b_index % 2))
        in_res = op(in_a, in_b)
        even = len(res) % 2
        if in_res ^ even:
            val, right, closed, singular = scan
            # added logic to switch direction of endpoints
            if even ^ right:
                res.append(endpoint_dual(scan))
            else:
                res.append(scan)
        if scan_from_a:
            a_index += 1
        if scan_from_b:
            b_index += 1
        if a_endpoints[a_index] is None:
            scan = b_endpoints[b_index]
        elif b_endpoints[b_index] is None:
            scan = a_endpoints[a_index]
        else:
            scan = endpoint_min(a_endpoints[a_index], b_endpoints[b_index])

    return normalise(intervals_from_endpoints(res))


####################################################################
# INTERVAL SET UNION
####################################################################

def set_difference(aList, bList):
    """
    set difference for intervals
    return intervals for segments covered by aList, but not by bList
    """
    if len(aList) == 0:
        return []
    if len(bList) == 0:
        return aList
    return _merge(aList, bList, lambda in_a, in_b: in_a and not in_b)


def set_union(aList, bList):
    """
    set union for intervals
    return intervals for segments covered by aList or bList

    equal to normalise
    """
    # return _merge(aList, bList, lambda in_a, in_b: in_a or in_b)
    return normalise([*aList, *bList])


def set_intersection(aList, bList):
    """
    set intersection for intervals
    return intervals for segments covered by both aList and bList
    """
    if len(aList) == 0 or len(bList) == 0:
        return []
    return _merge(aList, bList, lambda in_a, in_b: in_a and in_b)


####################################################################
# CHECK INPUT
####################################################################

def check_interval(itv):
    """Check that itv is valid interval."""
    if isinstance(itv, tuple):
        itv = list(itv)
    if not isinstance(itv, list):
        raise Exception("illegal interval", itv)
    _len = len(itv)
    if _len < 4:
        if _len == 0:
            raise Exception("empty interval", itv)
        elif _len == 1:
            itv.extend([itv[0], True, False])
        elif _len == 2:
            itv.extend([True, False])
        elif _len == 3:
            itv.extend([False])
    itv[2] = bool(itv[2])
    itv[3] = bool(itv[3])
    _typ0, _typ1, _typ2, _typ3 = [type(i) for i in itv]
    if itv[0] is not None:
        if _typ0 not in [int, float, ]:
            raise Exception("interval low must be number", itv)
    if itv[1] is not None:
        if _typ1 not in [int, float]:
            raise Exception("interval high must be number", itv)
    if itv[0] is not None and itv[1] is not None:
        if itv[0] > itv[1]:
            raise Exception("low is larger than high", itv)
    return itv
