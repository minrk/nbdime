# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

#import pytest
#import copy
import operator

from nbdime import diff
from nbdime.diff_format import op_patch, op_add, op_replace, op_remove
from nbdime.diffing.snakes import compute_snakes, compute_snakes_multilevel

from .utils import check_symmetric_diff_and_patch


def test_diff_and_patch():
    # Note: check_symmetric_diff_and_patch handles (a,b) and (b,a) for both
    # shallow and deep diffs, simplifying the number of cases to cover in here.

    # Empty
    mda = {}
    mdb = {}
    check_symmetric_diff_and_patch(mda, mdb)

    # One-sided content/empty
    mda = {"a": 1}
    mdb = {}
    check_symmetric_diff_and_patch(mda, mdb)

    # One-sided content/empty multilevel
    mda = {"a": 1, "b": {"ba": 21}}
    mdb = {}
    check_symmetric_diff_and_patch(mda, mdb)

    # One-sided content/empty multilevel
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {}
    check_symmetric_diff_and_patch(mda, mdb)

    # Partial delete
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31}}
    check_symmetric_diff_and_patch(mda, mdb)
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {"b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    check_symmetric_diff_and_patch(mda, mdb)
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {"b": {"ba": 21}, "c": {"cb": 32}}
    check_symmetric_diff_and_patch(mda, mdb)

    # One-level modification
    mda = {"a": 1}
    mdb = {"a": 10}
    check_symmetric_diff_and_patch(mda, mdb)

    # Two-level modification
    mda = {"a": 1, "b": {"ba": 21}}
    mdb = {"a": 10, "b": {"ba": 210}}
    check_symmetric_diff_and_patch(mda, mdb)
    mda = {"a": 1, "b": {"ba": 21}}
    mdb = {"a": 1, "b": {"ba": 210}}
    check_symmetric_diff_and_patch(mda, mdb)

    # Multilevel modification
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {"a": 10, "b": {"ba": 210}, "c": {"ca": 310, "cb": 320}}
    check_symmetric_diff_and_patch(mda, mdb)
    mda = {"a": 1, "b": {"ba": 21}, "c": {"ca": 31, "cb": 32}}
    mdb = {"a": 1, "b": {"ba": 210}, "c": {"ca": 310, "cb": 32}}
    check_symmetric_diff_and_patch(mda, mdb)

    # Multilevel mix of delete, add, modify
    mda = {"deleted": 1, "modparent": {"mod": 21}, "mix": {"del": 31, "mod": 32, "unchanged": 123}}
    mdb = {"added": 7,   "modparent": {"mod": 22}, "mix": {"add": 42, "mod": 37, "unchanged": 123}}
    check_symmetric_diff_and_patch(mda, mdb)
    # A more explicit assert showing the diff format and testing that paths are sorted:
    assert diff(mda, mdb) == [
        op_add("added", 7),
        op_remove("deleted"),
        op_patch("mix", [
            op_add("add", 42),
            op_remove("del"),
            op_replace("mod", 37),
            ]),
        op_patch("modparent", [
            op_replace("mod", 22)
            ]),
        ]


def test_compute_snakes_multilevel():
    a = [
        ("a0", "b0", "c0"),
        ("q", "y", "z"),
        ("a1", "b1", "c1"),
        ("a2", "b2", "c2"),
        ("a3", "b3", "c3"),
        ]
    b = [
        ("a0", "b0", "c"),
        ("a", "b", "c"),
        ("a2", "b2", "c2"),
        ("x", "y", "z"),
        ("x", "y", "z"),
        ("a3", "b", "c"),
        ]

    def _cmp_n(n):
        def _cmp(x, y):
            return x[:n] == y[:n]
        return _cmp
    compares = [_cmp_n(1), _cmp_n(2), operator.__eq__]

    snakes = compute_snakes_multilevel(a, b, compares)
    assert snakes == [(0, 0, 1), (3, 2, 1), (4, 5, 1)]

    # Test case to show how first level provides a coarse
    # identification and snakes from second level are merged
    # with the first ones
    A = ["aa", "ab", "ba", "bb"]
    B = ["aa", "ax", "ba", "bx"]
    compares = [
        lambda a,b: a == b,
        lambda a,b: a[0] == b[0],
        ]
    snakes = compute_snakes_multilevel(A, B, compares[:1])
    assert snakes == [(0,0,1), (2,2,1)]
    snakes = compute_snakes_multilevel(A, B, compares)
    assert snakes == [(0,0,4)]
