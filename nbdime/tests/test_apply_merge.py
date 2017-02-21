# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


import copy
import re

from nbdime import patch
from nbdime.diff_format import op_patch
from nbdime.merging.decisions import (
    apply_decisions, ensure_common_path, MergeDecision)

from nbdime import diff


def has_merge_conflicts(decisions):
    "Return whether there are conflicting entries or not."
    return any(item.conflict for item in decisions)


_r_is_int = re.compile("^[0-9]+$")


def is_int(n):
    return bool(_r_is_int.match(n))


def pick_merge_decision(base, dec):
    if dec.action is None or dec.action == "base":
        di = None
    elif dec.action == "local" or dec.action == "either":
        di = dec.local_diff
    elif dec.action == "remote":
        di = dec.remote_diff
    elif dec.action == "custom":
        di = dec.custom_diff
    else:
        raise ValueError("Unknown action {}".format(dec.action))

    if di is not None:
        # Parse common path
        keys = [k for k in dec.common_path.split("/") if k != ""]
        sub = base
        for k in keys:
            if isinstance(sub, list):
                k = int(k)
            sub = sub[k]
        # "/cells" -> sub = base[cells], sub is a list
        # patch

        # Add patch entries
        base_diff = di
        for k in reversed(keys):
            if is_int(k):
                k = int(k)
            base_diff = op_patch(k, base_diff)
        # Apply patch
        base = patch(base, base_diff)

    return base


def gather_merge_decisions(base, decisions):
    assert not has_merge_conflicts(decisions)
    for dec in decisions:
        base = pick_merge_decision(base, dec)
    return base


def create_decision_item(action=None, common_path="", conflict=False,
                         local_diff=None, remote_diff=None, custom_diff=None):

    # Some parameter validation here, but don't need to duplicate json schema
    if action is None:
        pass
    elif action == "local":
        assert local_diff
    elif action == "remote":
        assert remote_diff
    elif action == "custom":
        assert custom_diff
    elif action in ("either", "local_then_remote", "remote_then_local"):
        assert local_diff
        assert remote_diff
    else:
        pass

    item = MergeDecision({
            "action": action,
            "common_path": common_path,
            "conflict": conflict,
            "custom_diff": custom_diff,
            "local_diff": local_diff,
            "remote_diff": remote_diff,
        })
    return item


def _example_decisions():
    decisions = [
        create_decision_item(
            action="local",
            local_diff=""
            )
        ]
    return decisions


def test_apply_merge_empty():
    decisions = []
    base = {"hello": "world"}
    assert base == apply_decisions(base, decisions)


def test_apply_merge_on_dicts():
    base = {
        "metadata": {
            "a": {"ting": 123},
            "b": {"tang": 456}
        }
    }

    local = copy.deepcopy(base)
    local["metadata"]["a"]["ting"] += 1

    remote = copy.deepcopy(base)
    remote["metadata"]["a"]["ting"] -= 1

    bld = diff(base, local)
    brd = diff(base, remote)

    path, (bld, brd) = ensure_common_path((), [bld, brd])

    merge_decisions = [
        create_decision_item(
            action="remote",
            common_path=path,
            local_diff=bld,
            remote_diff=brd)
    ]

    assert remote == apply_decisions(base, merge_decisions)

# merge decisions with common path "cells" can modify cells/* indices
# merge decisions with common path "cells/*" only edit exactly one of the cells/* objects
# applying cells/* before cells means editing first, no indices modified, then moving things around
