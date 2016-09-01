# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function, unicode_literals

from six import string_types
import sys
import copy

from ..diff_format import DiffOp, op_replace
from ..patching import patch
from .chunks import make_merge_chunks
from ..utils import join_path, star_path
from .decisions import (pop_patch_decision, push_patch_decision, MergeDecision,
                        pop_all_patch_decisions, _sort_key)


# FIXME: Move to utils
def as_text_lines(text):
    if isinstance(text, string_types):
        text = text.splitlines(True)
    if isinstance(text, tuple):
        text = list(text)
    assert isinstance(text, list)
    assert all(isinstance(t, string_types) for t in text)
    return text


# FIXME: Move to utils
def format_text_merge_display(
        base, local, remote,
        base_title="base", local_title="local", remote_title="remote"):
    local = as_text_lines(local)
    base = as_text_lines(base)
    remote = as_text_lines(remote)

    n = 7  # git uses 7
    sep0 = "%s %s\n" % ("<"*n, local_title)
    sep1 = "%s %s\n" % ("="*n, base_title)
    sep2 = "%s %s\n" % ("="*n, remote_title)
    sep3 = "%s\n" % (">"*n,)

    return "".join([sep0] + local + [sep1] + base + [sep2] + remote + [sep3])


def add_conflicts_record(value, le, re):
    """Add an item 'nbdime-conflicts' to a metadata dict.

    Simply storing metadata conflicts for mergetool inspection.
    """
    assert isinstance(value, dict)
    c = {}
    if le is not None:
        c["local"] = le
    if re is not None:
        c["remote"] = re
    newvalue = dict(value)
    newvalue["nbdime-conflicts"] = c
    return newvalue


# Sentinel object
Deleted = object()


def patch_item(value, diffentry):
    if diffentry is None:
        return value
    op = diffentry.op
    if op == DiffOp.REPLACE:
        return diffentry.value
    elif op == DiffOp.PATCH:
        return patch(value, diffentry.diff)
    elif op == DiffOp.REMOVE:
        return Deleted
    else:
        raise ValueError("Invalid item patch op {}".format(op))


def make_join_value(value, le, re):
    # Joining e.g. an outputs list means concatenating all items
    lvalue = patch_item(value, le)
    rvalue = patch_item(value, re)

    if lvalue is Deleted:
        lvalue = []
    if rvalue is Deleted:
        rvalue = []

    # New list
    newvalue = value + lvalue + rvalue

    return newvalue


def make_inline_outputs_value(value, le, re,
                              local_title="local", remote_title="remote"):
    # FIXME: Use this for inline outputs diff?
    # Joining e.g. an outputs list means concatenating all items
    lvalue = patch_item(value, le)
    rvalue = patch_item(value, re)

    if lvalue is Deleted:
        lvalue = []
    if rvalue is Deleted:
        rvalue = []

    # Note: This is very notebook specific while the rest of this file is more generic
    newvalue = (
        [{"output_type": "stream", "name": "stderr", "text": ["<"*7 + local_title]}]
        + lvalue
        + [{"output_type": "stream", "name": "stderr", "text": ["="*7]}]
        + rvalue
        + [{"output_type": "stream", "name": "stderr", "text": ["<"*7 + remote_title]}]
        )

    return newvalue


def make_inline_source_value(base, le, re):  # FIXME: Test this!
    if le.op == DiffOp.REPLACE:
        local = le.value
    elif le.op == DiffOp.PATCH:
        local = patch(base, le.diff)
    elif le.op == DiffOp.REMOVE:
        local = []  # ""
    else:
        raise ValueError("Invalid item patch op {}".format(le.op))

    if re.op == DiffOp.REPLACE:
        remote = re.value
    elif re.op == DiffOp.PATCH:
        remote = patch(base, re.diff)
    elif re.op == DiffOp.REMOVE:
        remote = []  # ""
    else:
        raise ValueError("Invalid item patch op {}".format(re.op))

    # FIXME: use format_text_merge_display for each conflicting chunk?
    e = format_text_merge_display(base, local, remote)
    return e


def is_diff_all_transients(diff, path, transients):
    # Resolve diff paths and check them vs transients list
    for d in diff:
        # Convert to string to search transients:
        subpath = path + (d.key,)
        if d.op == DiffOp.PATCH:
            # Recurse
            if not is_diff_all_transients(d.diff, subpath, transients):
                return False
        else:
            # Check path vs transients
            if star_path(subpath) not in transients:
                return False
    return True


def strategy2action_dict(local_base, le, re, strategy, path, dec):
    assert le is None or re is None or le.key == re.key
    key = le.key if re is None else re.key

    print('autoresolving conflict at %s with %s' % (path, strategy), file=sys.stderr)

    # Make a shallow copy of dec
    dec = copy.copy(dec)

    # The rest here remove the conflicts and provide a new value
    # ... cases ignoring changes
    if strategy == "clear":
        dec.action = "clear"
        dec.conflict = False
    elif strategy == "clear-parent":
        dec.action = "clear_parent"
        dec.conflict = False
    elif strategy == "use-base":
        dec.action = "base"
        dec.conflict = False
    # ... cases ignoring changes from one side
    elif strategy == "use-local":
        dec.action = "local"
        dec.conflict = False
    elif strategy == "use-remote":
        dec.action = "remote"
        dec.conflict = False
    # ... cutoffs before cases using changes from both sides
    #  (NB! The position of these elif cases relative to the
    #   cases that check the strategy is important)
    elif le is None:
        # Only one sided change, use that
        dec.action = "remote"
        dec.conflict = False
    elif re is None:
        # Only one sided change, use that
        dec.action = "local"
        dec.conflict = False
    elif le == re:
        # Both changes are equal, just apply
        dec.action = "either"
        dec.conflict = False
    # ... fallthrough
    elif strategy == "mergetool":
        # Leave this type of conflict for external tool to resolve
        pass
    # ... fail
    elif strategy == "fail":
        # Expecting never to get this kind of conflict, raise error
        raise RuntimeError("Not expecting a conflict at path {}.".format(path))
    # ... cases using changes from both sides to produce a new value
    elif strategy == "join":
        dec.action = "local_then_remote"
        dec.conflict = False
    else:
        # TODO: Split these into multiple decisions?
        key = le.key if le.key else re.key
        value = local_base[key]
        if strategy == "inline-source":
            newvalue = make_inline_source_value(value, le, re)
        elif strategy == "inline-outputs":
            newvalue = make_inline_outputs_value(value, le, re)
        elif strategy == "record-conflict":
            newvalue = add_conflicts_record(value, le, re)
        else:
            raise RuntimeError("Invalid strategy {}.".format(strategy))
        dec.custom_diff = [op_replace(key, newvalue)]
        dec.action = "custom"

    return [dec]


def strategy2action_list(strategy, dec):
    "Resolve conflicts for all items in list."

    # Make a shallow copy of dec
    dec = copy.copy(dec)

    if strategy == "mergetool":
        # Leave this type of conflict for other tool to resolve
        return [dec]

    # The rest here remove the conflicts and provide a new value
    if strategy == "use-base":
        dec.action = "base"
        dec.conflict = False
    elif strategy == "use-local":
        dec.action = "local"
        dec.conflict = False
    elif strategy == "use-remote":
        dec.action = "remote"
        dec.conflict = False
    elif strategy == "join":
        dec.action = "local_then_remote"
        dec.conflict = False
    elif strategy == "clear":
        dec.action = "clear"
        dec.conflict = False
    elif strategy == "mergetool":
        # Leave this type of conflict for external tool to resolve
        pass
    elif strategy == "clear-parent":
        dec.action = "clear_parent"
        dec.conflict = False
    elif strategy == "fail":
        raise RuntimeError("Not expecting a conflict at path {}.".format(dec.common_path + '/*'))
    else:
        raise RuntimeError("Not expecting strategy {} for list items at path {}.".format(strategy, dec.common_path))

    return [dec]


def autoresolve_decision_on_list(dec, base, sub, strategies):
    assert isinstance(sub, list)

    ld = dec.local_diff
    rd = dec.remote_diff

    # Query how to handle conflicts in this part of the document
    strategy = strategies.get(join_path(dec.common_path + ('*',)))

    # Cutting off handling of strategies of subitems if there's a strategy for these list items
    if strategy:
        return strategy2action_list(strategy, dec)

    # Split up and combine diffs into chunks [(begin, end, localdiffs, remotediffs)]
    chunks = make_merge_chunks(sub, ld, rd)

    # Loop over chunks of base[j:k], grouping insertion at j into
    # the chunk starting with j
    decs = []
    for (j, k, d0, d1) in chunks:
        lpatches = [e for e in d0 if e.op == DiffOp.PATCH]
        rpatches = [e for e in d1 if e.op == DiffOp.PATCH]
        i = len(decs)
        if not (d0 or d1):
            # Unmodified chunk, no-op
            pass

        elif lpatches and rpatches:
            # Recurse if we have diffs available for both subdocuments
            assert len(lpatches) == 1
            assert len(rpatches) == 1
            linserts = [e for e in d0 if e.op == DiffOp.ADDRANGE]
            rinserts = [e for e in d1 if e.op == DiffOp.ADDRANGE]
            assert len(lpatches) + len(linserts) == len(d0)
            assert len(rpatches) + len(rinserts) == len(d1)
            assert k == j + 1
            assert all(e.key == j for e in linserts + rinserts)

            subdec = copy.copy(dec)
            subdec.local_diff = lpatches
            subdec.remote_diff = rpatches
            subdec = pop_patch_decision(subdec)
            decs.extend(autoresolve_decision(base, subdec, strategies))

            # Patch conflicts have been processed, split off inserts if present
            # and insert before patch:
            if linserts or rinserts:
                conflict = (bool(linserts) == bool(rinserts))
                decs.insert(i, MergeDecision(
                    common_path=dec.common_path,
                    action="local_then_remote",  # Will this suffice?
                    conflict=conflict,
                    local_diff=linserts,  # Should these be split up further?
                    remote_diff=rinserts,
                ))
        elif lpatches or rpatches:
            # One sided patch, with deletions on other (vs addition is not a
            # conflict)
            # Check that patch side only has one op (the patch)
            if lpatches:
                assert tuple(lpatches) == d0
            else:
                assert tuple(rpatches) == d1

            # Only action that can be taken is to check whether the patch ops
            # are all transients, and if so, take the other side
            for p in (lpatches or rpatches):
                # Convert to string to search transients
                subpath = dec.common_path + (p.key,)
                if not is_diff_all_transients(p.diff, subpath,
                                              strategies.transients):
                    # Cannot be auto resolved
                    subdec = copy.copy(dec)
                    subdec.local_diff = list(d0)
                    subdec.remote_diff = list(d1)
                    decs.append(subdec)
                    break
            else:
                # All patches are all transient, pick deletion:
                subdec = copy.copy(dec)
                subdec.action = "local" if rpatches else "remote"
                subdec.conflict = False
                decs.append(subdec)

        else:
            # FIXME: What has happened here? This is hard to follow, enumerate cases!
            # - at least one side is modified
            # - only 0 or 1 has a patch

            # Just keep chunked decision
            subdec = copy.copy(dec)
            subdec.local_diff = list(d0)
            subdec.remote_diff = list(d1)
            decs.append(subdec)

    return decs


def autoresolve_decision_on_dict(dec, base, sub, strategies):
    assert isinstance(sub, dict)

    ld = dec.local_diff
    rd = dec.remote_diff

    # I believe this to be true here
    assert len(ld) == 1 and len(rd) == 1
    assert ld[0].key == rd[0].key

    # Query how to handle conflicts in this part of the document
    key = ld[0].key
    subpath = join_path(dec.common_path + (key,))
    strategy = strategies.get(subpath)

    # Get value and conflicts
    le, = ld
    re, = rd

    if strategy is not None:
        decs = strategy2action_dict(sub, le, re, strategy, subpath, dec)
    elif le.op == DiffOp.PATCH and re.op == DiffOp.PATCH:
        # FIXME: this is not quite right:
        # Recurse if we have no strategy for this key but diffs available for the subdocument
        newdec = pop_patch_decision(dec)
        decs = autoresolve_decision(base, newdec, strategies)
    elif (DiffOp.PATCH in (le.op, re.op)) and (DiffOp.REMOVE in (le.op, re.op)):
        # Check for deletion vs. purely ignoreable changes (transients)
        # If not, leave conflicted
        patchop = le if le.op == DiffOp.PATCH else re
        if is_diff_all_transients(patchop.diff, dec.common_path + (key,),
                                  strategies.transients):
            # Go with deletion, and remove conflict
            dec.action = "local" if le.op == DiffOp.REMOVE else "remote"
            dec.conflict = False
        decs = [dec]

    else:
        # Alternatives if we don't have PATCH/PATCH or PATCH/REMOVE, are:
        #  - ADD/ADD: only happens if inserted values are different,
        #         could possibly autoresolve some cases but nothing important
        #  - REPLACE: technically possible, if so we can can convert it to PATCH,
        #             but does it happen?
        # No resolution, keep original decision
        decs = [dec]
    return decs


def autoresolve_decision(base, dec, strategies):
    """Autoresolve a single conflicting decision in isolation.

    Returns a list of 1 or more decisions, with or without further conflicts.
    """
    assert dec.conflict

    decs = []

    # Get the non-empty base-local and base-remote diffs
    assert dec.local_diff and dec.remote_diff

    # Get object in base that common_path points to, but short-circuit if a
    # strategy is encountered while traversing common_path
    sub = base
    subpath = ()

    for key in dec.common_path:
        subpath = subpath + (key,)
        strategy = strategies.get(join_path(subpath))
        if strategy is not None:
            # Strategy found for intermediate path
            # Bring decision up to same level as strategy:
            dec = push_patch_decision(
                dec, dec.common_path[len(subpath)-1:])
            break
        sub = sub[key]

    if isinstance(sub, dict):
        decs = autoresolve_decision_on_dict(dec, base, sub, strategies)
    elif isinstance(sub, list):
        decs = autoresolve_decision_on_list(dec, base, sub, strategies)
    elif isinstance(sub, string_types):
        raise NotImplementedError()
    else:
        raise RuntimeError("Expecting dict, list or string type, got " +
                           str(type(sub)))

    return [pop_all_patch_decisions(d) for d in decs]


def autoresolve(base, decisions, strategies):
    """Autoresolve a list of decisions with given strategy configuration.

    Returns a list of new decisions, with or without further conflicts.
    """
    newdecisions = []
    for dec in decisions:
        if dec.conflict:
            newdecisions.extend(autoresolve_decision(base, dec, strategies))
        else:
            newdecisions.append(dec)
    return sorted(newdecisions, key=_sort_key, reverse=True)
