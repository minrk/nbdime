# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six.moves import xrange as range

import pytest

from nbdime import patch
from nbdime.diff_format import is_valid_diff

import nbdime.diffing.sequences
from nbdime.diffing.sequences import diff_sequence


def check_diff_sequence_and_patch(a, b):
    d = diff_sequence(a, b)
    assert is_valid_diff(d)
    assert patch(a, d) == b
    d = diff_sequence(b, a)
    assert is_valid_diff(d)
    assert patch(b, d) == a

#algorithms = ["difflib", "bruteforce", "myers"]
algorithms = ["difflib", "bruteforce"]


@pytest.yield_fixture(params=algorithms)
def algorithm(request):
    alg = nbdime.diffing.sequences.diff_sequence_algorithm
    nbdime.diffing.sequences.diff_sequence_algorithm = request.param
    yield request.param
    nbdime.diffing.sequences.diff_sequence_algorithm = alg


def test_diff_sequence(algorithm):
    "FIXME: Add wide range of test cases here."

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
