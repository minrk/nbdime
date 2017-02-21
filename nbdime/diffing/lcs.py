# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six.moves import xrange as range

from ..diff_format import SequenceDiffBuilder


def diff_from_lcs(A, B, A_indices, B_indices):
    """Compute the diff of A and B, given indices of their lcs."""
    di = SequenceDiffBuilder()
    N, M = len(A), len(B)
    llcs = len(A_indices)
    assert llcs == len(B_indices)
    # x,y = how many symbols we have consumed from A and B
    x = 0
    y = 0
    for r in range(llcs):
        i = A_indices[r]
        j = B_indices[r]
        if i > x:
            di.removerange(x, i-x)
        if j > y:
            di.addrange(x, B[y:j])
        x = i + 1
        y = j + 1
    if x < N:
        di.removerange(x, N-x)
    if y < M:
        di.addrange(x, B[y:M])
    return di.validated()
