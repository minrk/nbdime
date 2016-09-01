# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import unicode_literals

import pytest
import operator
from collections import defaultdict

from nbdime import merge_notebooks, diff, decide_merge, apply_decisions

from nbdime.merging.generic import decide_merge_with_diff
from nbdime.merging.autoresolve import autoresolve
from nbdime.utils import Strategies


# FIXME: Extend tests to more merge situations!


# Tests here assume default autoresolve behaviour at time of writing,
# this is likely to change and it's ok to update the tests to reflect
# new behaviour as needed!


def xtest_autoresolve_inline_outputs():
    #value =
    #le =
    #re =
    #expected =
    #assert make_inline_outputs_value(value, le, re) == expected
    pass


def xtest_autoresolve_join():
    #value =
    #le =
    #re =
    #expected =
    #assert make_join_value(value, le, re) == expected
    pass


base = {"foo": 1}
local = {"foo": 2}
remote = {"foo": 3}
conflicted_decisions = decide_merge(base, local, remote)


def test_autoresolve_dict_fail():
    """Check that "fail" strategy results in proper exception raised."""
    strategies = {"/foo": "fail"}
    with pytest.raises(RuntimeError):
        autoresolve(base, conflicted_decisions, strategies)

    base2 = {"foo": {"bar": 1}}
    local2 = {"foo": {"bar": 2}}
    remote2 = {"foo": {"bar": 3}}
    strategies = {"/foo/bar": "fail"}
    decisions = decide_merge(base2, local2, remote2)
    with pytest.raises(RuntimeError):
        autoresolve(base2, decisions, strategies)
    strategies = {"/foo": "fail"}
    with pytest.raises(RuntimeError):
        autoresolve(base2, decisions, strategies)


def test_autoresolve_dict_clear():
    """Check strategy "clear" in various cases."""

    base2 = {"foo": [1, 2]}
    local2 = {"foo": [1, 4, 2]}
    remote2 = {"foo": [1, 3, 2]}
    decisions = decide_merge(base2, local2, remote2)
    assert apply_decisions(base2, decisions) == {"foo": [1, 2]}
    assert decisions[0].local_diff != []
    assert decisions[0].remote_diff != []
    strategies = {"/foo": "clear-parent"}
    resolved = autoresolve(base2, decisions, strategies)
    assert apply_decisions(base2, resolved) == {"foo": []}
    assert not any([d.conflict for d in resolved])

    strategies = {"/foo": "clear"}
    resolved = autoresolve(base2, decisions, strategies)
    assert apply_decisions(base2, resolved) == {"foo": [1, None]}
    assert not any([d.conflict for d in resolved])


def test_autoresolve_dict_use_one_side():
    strategies = {"/foo": "use-base"}
    decisions = autoresolve(base, conflicted_decisions, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base, decisions) == {"foo": 1}

    strategies = {"/foo": "use-local"}
    decisions = autoresolve(base, conflicted_decisions, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base, decisions) == {"foo": 2}

    strategies = {"/foo": "use-remote"}
    decisions = autoresolve(base, conflicted_decisions, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base, decisions) == {"foo": 3}

    base2 = {"foo": {"bar": 1}}
    local2 = {"foo": {"bar": 2}}
    remote2 = {"foo": {"bar": 3}}
    conflicted_decisions2 = decide_merge(base2, local2, remote2)

    strategies = {"/foo/bar": "use-base"}
    decisions = autoresolve(base2, conflicted_decisions2, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base2, decisions) == {"foo": {"bar": 1}}

    strategies = {"/foo/bar": "use-local"}
    decisions = autoresolve(base2, conflicted_decisions2, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base2, decisions) == {"foo": {"bar": 2}}

    strategies = {"/foo/bar": "use-remote"}
    decisions = autoresolve(base2, conflicted_decisions2, strategies)
    assert not any([d.conflict for d in decisions])
    assert apply_decisions(base2, decisions) == {"foo": {"bar": 3}}


def test_autoresolve_list_transients():
    # For this test, we need to use a custom predicate to ensure alignment
    common = {'id': 'This ensures alignment'}
    predicates = defaultdict(lambda: [operator.__eq__], {
        '/': [lambda a, b: a['id'] == b['id']],
    })
    # Setup transient difference in base and local, deletion in remote
    b = [{'transient': 22}]
    l = [{'transient': 242}]
    b[0].update(common)
    l[0].update(common)
    r = []

    # Make decisions based on diffs with predicates
    ld = diff(b, l, path="", predicates=predicates)
    rd = diff(b, r, path="", predicates=predicates)
    decisions = decide_merge_with_diff(b, l, r, ld, rd)

    # Assert that generic merge gives conflict
    assert apply_decisions(b, decisions) == b
    assert len(decisions) == 1
    assert decisions[0].conflict

    # Without strategy, no progress is made:
    resolved = autoresolve(b, decisions, Strategies())
    assert resolved == decisions

    # Supply transient list to autoresolve, and check that transient is ignored
    strategies = Strategies(transients=[
        '/*/transient'
    ])
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)


def test_autoresolve_list_conflicting_insertions_simple():
    # local and remote adds an entry each
    b = [1]
    l = [1, 2]
    r = [1, 3]
    decisions = decide_merge(b, l, r)

    strategies = {"/*": "use-local"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == l
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-remote"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-base"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == b
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "join"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == [1, 2, 3]
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "clear-parent"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == []
    assert not any(d.conflict for d in resolved)


def test_autoresolve_list_conflicting_insertions_mixed():
    # local and remote adds an equal entry plus a different entry each
    # First, test when insertions DO NOT chunk together:
    b = [1, 9]
    l = [1, 2, 9, 11]
    r = [1, 3, 9, 11]
    decisions = decide_merge(b, l, r)

    # Check strategyless resolution
    strategies = {}
    resolved = autoresolve(b, decisions, strategies)
    expected_partial = [1, 9, 11]
    assert apply_decisions(b, resolved) == expected_partial
    assert len(resolved) == 2
    assert resolved[0].conflict
    assert not resolved[1].conflict

    strategies = {"/*": "use-local"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == l
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-remote"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-base"}
    resolved = autoresolve(b, decisions, strategies)
    # Strategy is only applied to conflicted decisions:
    assert apply_decisions(b, resolved) == expected_partial
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "join"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == [1, 2, 3, 9, 11]
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "clear-parent"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == []
    assert not any(d.conflict for d in resolved)

    # Next, test when insertions DO chunk together:
    b = [1, 9]
    l = [1, 2, 7, 9]
    r = [1, 3, 7, 9]
    decisions = decide_merge(b, l, r)

    # Check strategyless resolution
    strategies = {}
    resolved = autoresolve(b, decisions, strategies)
    expected_partial = [1, 7, 9]
    assert apply_decisions(b, resolved) == expected_partial
    assert resolved == decisions  # Not able to resolve anything

    strategies = {"/*": "use-local"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == l
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-remote"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "use-base"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == expected_partial
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "join"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == [1, 2, 3, 7, 9]
    assert not any(d.conflict for d in resolved)

    strategies = {"/*": "clear-parent"}
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == []
    assert not any(d.conflict for d in resolved)


def test_autoresolve_dict_transients():
    # For this test, we need to use a custom predicate to ensure alignment

    common = {'id': 'This ensures alignment'}
    # Setup transient difference in base and local, deletion in remote
    b = {'a': {'transient': 22}}
    l = {'a': {'transient': 242}}
    r = {}

    # Make decisions based on diffs with predicates
    decisions = decide_merge(b, l, r)

    # Assert that generic merge gives conflict
    assert apply_decisions(b, decisions) == b
    assert len(decisions) == 1
    assert decisions[0].conflict

    # Without strategy, no progress is made:
    resolved = autoresolve(b, decisions, Strategies())
    assert resolved == decisions

    # Supply transient list to autoresolve, and check that transient is ignored
    strategies = Strategies(transients=[
        '/a/transient'
    ])
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)


def test_autoresolve_mixed_nested_transients():
    # For this test, we need to use a custom predicate to ensure alignment
    common = {'id': 'This ensures alignment'}
    predicates = defaultdict(lambda: [operator.__eq__], {
        '/': [lambda a, b: a['id'] == b['id']],
    })
    # Setup transient difference in base and local, deletion in remote
    b = [{'a': {'transient': 22}}]
    l = [{'a': {'transient': 242}}]
    b[0].update(common)
    l[0].update(common)
    r = []

    # Make decisions based on diffs with predicates
    ld = diff(b, l, path="", predicates=predicates)
    rd = diff(b, r, path="", predicates=predicates)
    decisions = decide_merge_with_diff(b, l, r, ld, rd)

    # Assert that generic merge gives conflict
    assert apply_decisions(b, decisions) == b
    assert len(decisions) == 1
    assert decisions[0].conflict

    # Without strategy, no progress is made:
    resolved = autoresolve(b, decisions, Strategies())
    assert resolved == decisions

    # Supply transient list to autoresolve, and check that transient is ignored
    strategies = Strategies(transients=[
        '/*/a/transient'
    ])
    resolved = autoresolve(b, decisions, strategies)
    assert apply_decisions(b, resolved) == r
    assert not any(d.conflict for d in resolved)


def test_autoresolve_notebook_ec():
    # Tests here assume default autoresolve behaviour at time of writing,
    # this may change and tests should then be updated
    args = None

    source = "def foo(x, y):\n    return x**y"
    base = {"cells": [{
        "source": source, "execution_count": 1, "cell_type": "code",
        "outputs": None}]}
    local = {"cells": [{
        "source": source, "execution_count": 2, "cell_type": "code",
        "outputs": None}]}
    remote = {"cells": [{
        "source": source, "execution_count": 3, "cell_type": "code",
        "outputs": None}]}
    merged, decisions = merge_notebooks(base, local, remote, args)
    assert merged == {"cells": [{
        "source": source, "execution_count": None, "outputs": None,
        "cell_type": "code"}]}
    assert not any(d.conflict for d in decisions)
