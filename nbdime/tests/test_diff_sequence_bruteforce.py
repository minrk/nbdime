# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six.moves import xrange as range

from nbdime import patch
from nbdime.diff_format import is_valid_diff
from nbdime.diffing.lcs import diff_from_lcs
from nbdime.diffing.seq_bruteforce import (bruteforce_compare_grid, bruteforce_llcs_grid,
                                           bruteforce_lcs_indices, diff_sequence_bruteforce)


def test_diff_sequence_bruteforce():
    examples = [
        ([], []),
        ([1], [1]),
        ([1, 2], [1, 2]),
        ([2, 1], [1, 2]),
        ([1, 2, 3], [1, 2]),
        ([2, 1, 3], [1, 2]),
        ([1, 2], [1, 2, 3]),
        ([2, 1], [1, 2, 3]),
        ([1, 2], [1, 2, 1, 2]),
        ([1, 2, 1, 2], [1, 2]),
        ([1, 2, 3, 4, 1, 2], [3, 4, 2, 3]),
        (list("abcab"), list("ayb")),
        (list("xaxcxabc"), list("abcy")),
        ]
    for a, b in examples:
        G = bruteforce_compare_grid(a, b)
        assert all(bool(G[i][j]) == (a[i] == b[j]) for i in range(len(a)) for j in range(len(b)))

        R = bruteforce_llcs_grid(G)
        for i in range(len(a)):
            for j in range(len(b)):
                assert R[i+1][j+1] >= R[i][j]
                assert R[i+1][j] >= R[i][j]
                assert R[i][j+1] >= R[i][j]
                assert R[i+1][j+1] - R[i][j] <= 1
                assert R[i+1][j] - R[i][j] <= 1
                assert R[i][j+1] - R[i][j] <= 1
        llcs = R[len(a)][len(b)]

        A_indices, B_indices = bruteforce_lcs_indices(a, b, G, R)
        assert len(A_indices) == len(B_indices)
        assert len(A_indices) == llcs
        assert all(a[A_indices[r]] == b[B_indices[r]] for r in range(llcs))

        d = diff_from_lcs(a, b, A_indices, B_indices)
        assert is_valid_diff(d)
        assert patch(a, d) == b

        # Test combined function (repeats the above pieces)
        assert patch(a, diff_sequence_bruteforce(a, b)) == b
