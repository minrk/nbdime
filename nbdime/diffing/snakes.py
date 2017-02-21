# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


"""
Utilities for computing 'snakes', or contiguous sequences of equal elements of two sequences.
"""

from ..diff_format import SequenceDiffBuilder
from .seq_bruteforce import bruteforce_compute_snakes

__all__ = ["compute_snakes_multilevel"]


def compute_snakes(A, B, compare, rect=None):
    if rect is None:
        rect = (0, 0, len(A), len(B))
    i0, j0, i1, j1 = rect

    # TODO: Implement this using difflib or recursive Myers or simpler
    # non-recursive Myers algorithm without the middle snake stuff

    # snakes = [(i, j, n)]
    snakes = bruteforce_compute_snakes(A[i0:i1], B[j0:j1], compare)
    snakes = [(i+i0, j+j0, n) for (i, j, n) in snakes]

    assert all(compare(A[i+k], B[j+k]) for (i, j, n) in snakes for k in range(n))
    return snakes


def compute_snakes_multilevel(A, B, compares, rect=None, level=None):
    """Compute snakes using a multilevel multi-predicate algorithm.

    TODO: Document this algorithm.
    """
    if level is None:
        level = len(compares) - 1
    if rect is None:
        rect = (0, 0, len(A), len(B))

    # Compute initial set of coarse snakes
    compare = compares[level]
    snakes = compute_snakes(A, B, compare, rect)
    if level == 0:
        return snakes

    newsnakes = [(0, 0, 0)]
    i0, j0, i1, j1 = rect
    for snake in snakes + [(i1, j1, 0)]:
        i, j, n = snake
        if i > i0 and j > j0:
            # Recurse to compute snakes with less accurate
            # compare predicates between the coarse snakes
            subrect = (i0, j0, i, j)
            newsnakes += compute_snakes_multilevel(A, B, compares, subrect, level-1)
        if n > 0:
            li, lj, ln = newsnakes[-1]
            if li+ln == i and lj+ln == j:
                # Merge contiguous snakes
                newsnakes[-1] = (li, lj, ln + n)
            else:
                # Add new snake
                newsnakes.append(snake)
        i0 = i + n
        j0 = j + n
    # Pop empty snake from beginning if it wasn't extended inside the loop
    if newsnakes[0][2] == 0:
        newsnakes.pop(0)
    return newsnakes


def compute_diff_from_snakes(a, b, snakes, path="", predicates=None, differs=None):
    "Compute diff from snakes."

    subpath = "/".join((path, "*"))
    diffit = differs[subpath]

    di = SequenceDiffBuilder()
    i0, j0, i1, j1 = 0, 0, len(a), len(b)
    for i, j, n in snakes + [(i1, j1, 0)]:
        if i > i0:
            di.removerange(i0, i-i0)
        if j > j0:
            di.addrange(i0, b[j0:j])

        for k in range(n):
            aval = a[i + k]
            bval = b[j + k]
            cd = diffit(aval, bval, path=subpath, predicates=predicates, differs=differs)
            if cd:
                di.patch(i + k, cd)

        # Update corner offsets for next rectangle
        i0, j0 = i+n, j+n
    return di.validated()
