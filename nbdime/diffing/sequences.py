# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


import operator
from six import string_types
from collections import defaultdict

from .seq_difflib import diff_sequence_difflib
from .seq_bruteforce import diff_sequence_bruteforce
from .seq_myers import diff_sequence_myers

__all__ = ["diff_strings_by_char", "diff_sequence", "diff_strings_linewise"]


# TODO: Configuration framework?
# legal_diff_sequence_algorithms = ["bruteforce", "difflib", "myers"]
diff_sequence_algorithm = "bruteforce"


def diff_sequence(a, b, compare=operator.__eq__):
    """Compute a shallow diff of two sequences.

    I.e. these algorithms do not recursively diff elements of the sequences.

    This is a wrapper for alternative diff implementations.
    """
    if diff_sequence_algorithm == "difflib":
        if compare is not operator.__eq__:
            raise RuntimeError("Cannot use difflib with comparison other than ==.")
        return diff_sequence_difflib(a, b)
    elif diff_sequence_algorithm == "bruteforce":
        return diff_sequence_bruteforce(a, b, compare)
    elif diff_sequence_algorithm == "myers":
        return diff_sequence_myers(a, b, compare)
    else:
        raise RuntimeError("Unknown diff_sequence_algorithm {}.".format(diff_sequence_algorithm))


def diff_strings_by_char(a, b, path="", predicates=None, differs=None):
    "Compute char-based diff of two strings."
    assert isinstance(a, string_types) and isinstance(b, string_types)
    if a == b:
        return []
    else:
        return diff_sequence_difflib(a, b)


def diff_strings_linewise(a, b):
    """Do a line-wise diff of two strings
    """
    assert isinstance(a, string_types) and isinstance(b, string_types)
    lines_a = a.splitlines(True)
    lines_b = b.splitlines(True)

    from .generic import diff_lists, compare_strings_approximate
    predicates = defaultdict(lambda: [
        compare_strings_approximate,
        operator.__eq__])
    differs = defaultdict(lambda: diff_strings_by_char)
    return diff_lists(lines_a, lines_b, predicates=predicates, differs=differs)
