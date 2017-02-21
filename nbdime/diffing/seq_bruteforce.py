# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six.moves import xrange as range
import operator
from .lcs import diff_from_lcs

__all__ = ["diff_sequence_bruteforce"]


def bruteforce_compare_grid(A, B, compare=operator.__eq__):
    "Brute force compute grid G[i, j] == compare(A[i], B[j])."
    return [[compare(a, b) for b in B] for a in A]


def bruteforce_llcs_grid(G):
    "Brute force compute grid R[x][y] == llcs(A[:x], B[:y]), given G[i][j] = compare(A[i], B[j])."
    N = len(G)
    M = len(G[0]) if N else 0

    R = [[0]*(M+1) for i in range(N+1)]
    for x in range(1, N+1):
        for y in range(1, M+1):
            if G[x-1][y-1]:
                R[x][y] = R[x-1][y-1] + 1
            else:
                R[x][y] = max(R[x-1][y], R[x][y-1])
    return R


def bruteforce_lcs_indices(A, B, G, R, compare=operator.__eq__):
    """Brute force compute the lcs of A and B.

    Returns two lists (A_indices, B_indices) with length == llcs(A, B),
    such that lcs(A, B) == A[A_indices] == B[B_indices].
    """
    N, M = len(A), len(B)
    A_indices = []
    B_indices = []
    x = N
    y = M
    while x > 0 and y > 0:
        if G[x-1][y-1]:
            assert R[x][y] == R[x-1][y-1] + 1
            x -= 1
            y -= 1
            A_indices.append(x)
            B_indices.append(y)
        elif R[x][y] == R[x-1][y]:
            x -= 1
        else:
            assert R[x][y] == R[x][y-1]
            y -= 1
    A_indices.reverse()
    B_indices.reverse()
    return A_indices, B_indices


def bruteforce_compute_snakes(A, B, compare):
    """Compute snakes using brute force algorithm.

    Return a list of snakes, where each snake is a tuple (i,j,n)
    representing a range of n elements that compare equal
    in A and B starting at i and j, i.e. compare(x,y) returns
    True for x,y in zip(A[i:i+n], B[j:j+n]).
    """
    G = bruteforce_compare_grid(A, B, compare)
    R = bruteforce_llcs_grid(G)
    A_indices, B_indices = bruteforce_lcs_indices(A, B, G, R, compare)
    snakes = [(0, 0, 0)]
    for i, j in zip(A_indices, B_indices):
        if snakes[-1][0] == i and snakes[-1][1] == j:
            snake = snakes[-1]
            snakes[-1] = (snake[0], snake[1], snake[2] + 1)
        else:
            snakes.append((i, j, 1))
    if snakes[0][2] == 0:
        snakes.pop(0)
    return snakes


def diff_sequence_bruteforce(A, B, compare=operator.__eq__):
    """Compute the diff of A and B using expensive brute force O(MN) algorithms."""
    G = bruteforce_compare_grid(A, B, compare)
    R = bruteforce_llcs_grid(G)
    A_indices, B_indices = bruteforce_lcs_indices(A, B, G, R, compare)
    return diff_from_lcs(A, B, A_indices, B_indices)
