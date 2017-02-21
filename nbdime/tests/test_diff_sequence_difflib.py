# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six.moves import xrange as range
from nbdime import patch
from nbdime.diffing.seq_difflib import diff_sequence_difflib
from nbdime.diff_format import is_valid_diff


def check_diff_sequence_and_patch(a, b):
    d = diff_sequence_difflib(a, b)
    assert is_valid_diff(d)
    assert patch(a, d) == b
    d = diff_sequence_difflib(b, a)
    assert is_valid_diff(d)
    assert patch(b, d) == a


def test_diff_sequence_difflib():
    a = """\
    def f(a, b):
        c = a * b
        return c

    def g(x):
        y = x**2
        return y
    """.splitlines()

    b = []
    check_diff_sequence_and_patch(a, b)

    for i in range(len(a)+1):
        for j in range(len(a)+1):
            for k in range(len(a)+1):
                for l in range(len(a)+1):
                    b = a[i:j] + a[k:l]
                    check_diff_sequence_and_patch(a, b)
