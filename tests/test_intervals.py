
import src.server.intervals as intervals


def test_order():
    # 4], [4
    e1 = [4, True, True, False]
    e2 = [4, False, True, False]
    res = intervals.endpoint_cmp(e1, e2)
    assert res == 1


def test_itv_cmp():
    a = (2, 4, False, True)

    # b is outside a on the left
    b = (0, 1, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.OUTSIDE_LEFT

    # b is overlaps a from left
    b = (0, 3, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.OVERLAP_LEFT

    # b is covered by a
    b = (2.5, 3.5, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.COVERED

    # b is equal to a
    b = (2, 4, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.EQUALS

    # b covers a
    b = (1.5, 4.5, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.COVERS

    # b is overlaps a from right
    b = (3, 6, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.OVERLAP_RIGHT

    # b is outside a on the right
    b = (5, 7, False, True)
    rel = intervals.compare(b, a)
    assert rel == intervals.IntervalRelation.OUTSIDE_RIGHT


def test_normalise():

    a1 = [1, 3, True, False]
    a2 = [3, 4, False, False]        
    b1 = [1.5, 3.5, True, False]
    b2 = [3.5, 4.5, False, False]
    s1 = [3.5, 3.5, True, True]
    s2 = [4.5, 4.5, True, True]

    # overlap
    res = intervals.normalise([a1, a2, b1, b2])
    expect = [[1, 4.5, True, False]]
    assert res == expect

    # no overlapp
    res = intervals.normalise([b1, b2])
    expect = [b1, b2]
    assert res == expect

    # singular
    res = intervals.normalise([b2, s1, b1, s2])
    expect = [[1.5, 4.5, True, True]]
    assert res == expect

    # duplicates
    res = intervals.normalise([a1, a2, a1, a2])
    expect = [a1, a2]
    assert res == expect


def test_set_union():

    b1 = [1.5, 3.5, True, False]
    b2 = [3.5, 4.5, False, False]
    s1 = [3.5, 3.5, True, True]
    s2 = [4.5, 4.5, True, True]
    res = intervals.set_union([b1, b2], [s1, s2])
    expect = [[1.5, 4.5, True, True]]
    assert res == expect


def test_set_difference():

    a1 = [1, 3, True, False]
    a2 = [3, 4, False, False]        
    b2 = [3.5, 4.5, False, False]
    s1 = [2.5, 2.5, True, True]

    res = intervals.set_difference([a1, a2], [s1, b2])
    expect = [
        [1, 2.5, True, False],
        [2.5, 3, False, False],
        [3, 3.5, False, True]
    ]
    assert res == expect


def test_set_intersection():
    a1 = [1, 3, True, False]
    a2 = [3, 4, False, False]        
    b1 = [1.5, 3.5, True, False]
    b2 = [3.5, 4.5, False, False]

    res = intervals.set_intersection([a1, a2], [b1, b2])
    expect = [
        [1.5, 3, True, False],
        [3, 3.5, False, False],
        [3.5, 4, False, False]
    ]
    assert res == expect


def test_move():

    # move intervall
    olds = [[0, 1000, True, False]]
    news = [[500, 1500, True, False]]

    exit = intervals.set_difference(olds, news)
    enter = intervals.set_difference(news, olds)
    keep = intervals.set_intersection(olds, news)

    assert exit == [[0, 500, True, False]]
    assert enter == [[1000, 1500, True, False]]
    assert keep == [[500, 1000, True, False]]


def test_infinity():

    a = [None, None, True, True]
    b = [1.5, 3.5, True, False]
    res = intervals.normalise([a, b])
    assert res == [a]

    res = intervals.set_intersection([a], [b])
    assert res == [b]

    res = intervals.set_union([a], [b])
    assert res == [a]

    res = intervals.set_difference([a], [b])
    assert res == [
                    [None, 1.5, True, False],
                    [3.5, None, True, True]
                ]


def test_overlap():

    b = (4, 10, True, False)

    # no overlap
    a = (1, 2, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "keep"
    assert left is None
    assert right is None

    # overlap to the left
    a = (1, 6, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left == [1, 4, True, False]
    assert right is None

    # overlap to the right
    a = (6, 12, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left is None
    assert right == [10, 12, True, False]

    # a overlapped by b
    a = (5, 7, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "drop"
    assert left is None
    assert right is None

    # a covers b
    a = (1, 12, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left == [1, 4, True, False]
    assert right == [10, 12, True, False]

    # corner case 1 - a covers b - but empty right interval
    a = (1, 10, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left == [1, 4, True, False]
    assert right is None

    # corner case 2 - a covers b - singular right interval
    a = (1, 10, True, True)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left == [1, 4, True, False]
    assert right == [10, 10, True, True]

    # corner case 3 - a covers b - empty left interval
    a = (4, 12, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left is None
    assert right == [10, 12, True, False]

    # corner case 4 - a overlaps b - empty left interval
    a = (4, 12, False, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "trunc"
    assert left is None
    assert right == [10, 12, True, False]

    # equal
    a = (4, 10, True, False)
    op, left, right = intervals.overlay(a, b)
    assert op == "drop"
    assert left is None
    assert right is None
