# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


import nbformat
from six import string_types
import copy
from collections import defaultdict
from itertools import chain

from .decisions import MergeDecisionBuilder
from .chunks import make_merge_chunks
from ..diffing import diff
from ..diff_format import (
    DiffEntry, DiffOp, ParentDeleted, Missing, as_dict_based_diff,
    op_patch, op_addrange, op_removerange, op_add, op_remove, op_replace)
from ..diffing.notebooks import notebook_predicates, notebook_differs
from ..patching import patch
from ..utils import star_path, join_path, Strategies
import nbdime.log
from nbdime.prettyprint import merge_render
from nbdime.merging.decisions import pop_all_patch_decisions, push_patch_decision


# =============================================================================
#
# Utility code follows
#
# =============================================================================

def is_diff_all_transients(diff, path, transients):
    "Check if all diffs have paths in the transients set."
    # Resolve diff paths and check them vs transients list
    for d in diff:
        subpath = path + (d.key,)
        in_transients = star_path(subpath) in transients
        if d.op == DiffOp.PATCH:
            if in_transients:
                # Don't recurse below this level, if
                # e.g. /cells/*/outputs is marked transient,
                # we don't need every possible leaf node to be marked
                pass
            elif not is_diff_all_transients(d.diff, subpath, transients):
                return False
        else:
            # Check path vs transients
            if not in_transients:
                return False
    return True


# TODO: Add this to strategies object instead
countering_strategies = ("inline-source",)

def will_diff_counter_parent_deletion(diff, path, strategies):
    """Check if any diff touches a subdocument with a merge strategy
    that can counter parent document deletion, typically by inserting
    markers (currently only inline-source)."""
    # Resolve diff paths and check them vs transients list
    for d in diff:
        # Check path vs countering strategies
        subpath = path + (d.key,)
        s = strategies.get(star_path(subpath))
        if s in countering_strategies:
            # Cutoff at first opportunity, only
            # need one strategy to apply to
            # counter deletion
            return True
        # Recurse
        if d.op == DiffOp.PATCH:
            if will_diff_counter_parent_deletion(
                    d.diff, subpath, strategies):
                return True
    return False


def create_parent_deletion_counter_diff(diff, path, strategies):
    ""
    newdiff = []
    # Resolve diff paths and check them vs transients list
    for d in diff:
        # Check path vs countering strategies
        subpath = path + (d.key,)
        s = strategies.get(star_path(subpath))
        if s in countering_strategies:
            # This op is intended for internal use only
            p = DiffEntry(key=d.key, op="parent_deleted")
            newdiff.append(p)
        elif d.op == DiffOp.PATCH:
            # Only recurse if we didn't match a strategy here
            subdiff = create_parent_deletion_counter_diff(
                d.diff, subpath, strategies)
            p = op_patch(d.key, subdiff)
            newdiff.append(p)
    return newdiff


def split_diffs_by_index(diffs):
    """Splits list diffs (removeranges) by index and return
    dict mapping index to list of diff entries affecting that index."""
    diffs_by_index = defaultdict(list)
    for d in diffs:
        if d.op == DiffOp.REMOVERANGE:
            for i in range(d.key, d.key + d.length):
                diffs_by_index[i].append(op_removerange(i, 1))
        else:
            diffs_by_index[d.key].append(d)
    return diffs_by_index


def bundle_decisions_by_index(base_path, decisions):
    decisions_by_index = defaultdict(list)
    level = len(base_path)
    for d in decisions:
        assert base_path == d.common_path[:level]
        if len(d.common_path) > level:
            # At least patch/patch will have common_path on a particular item
            key = d.common_path[level]
            # Wrap decision diffs in patches so common_path points to list
            prefix = d.common_path[level:]
            d = push_patch_decision(d, prefix)
        else:
            # Removerange or addrange will have common_path
            # on list and key only in the diff entries
            keys = set(e.key for e in chain(d.local_diff, d.remote_diff, d.get("custom_diff", ())))
            assert len(keys) == 1
            key, = keys
        decisions_by_index[key].append(d)
    return decisions_by_index


def combine_patches(diffs):
    """Rewrite diffs in canonical form where only one patch
    applies to one key and diff entries are sorted by key."""
    patches = {}
    newdiffs = []
    for d in diffs:
        if d.op == DiffOp.PATCH:
            p = patches.get(d.key)
            if p is None:
                p = op_patch(d.key, combine_patches(d.diff))
                newdiffs.append(p)
                patches[d.key] = p
            else:
                p.diff = combine_patches(p.diff + d.diff)
        else:
            newdiffs.append(d)
    return sorted(newdiffs, key=lambda x: x.key)


def __unused__wrap_subconflicts(key, subconflicts):
    "Wrap diffs in conflict tuples in patches with given key."
    unresolved_conflicts = []
    for conf in subconflicts:
        (path, ld, rd, strategy) = conf
        assert path[-1] == key
        assert ld is not None
        assert rd is not None
        path = path[:-1]
        ld = [op_patch(key, ld)]
        rd = [op_patch(key, rd)]
        unresolved_conflicts.append((path, ld, rd, strategy))
    return unresolved_conflicts


def __unused__tryresolve_conflicts(conflicts, decisions):
    """Try to resolve conflicts with strategies.

    conflicts is a list of tuples on the format
    (path, local_diff, remote_diff, strategy)

    Decisions will be added to the given decisions builder.

    Remaining conflicts will be returned.
    """
    unresolved_conflicts = []
    for conf in conflicts:
        (path, ld, rd, strategy) = conf
        action_taken = decisions.tryresolve(path, ld, rd, strategy=strategy)
        if not action_taken:
            unresolved_conflicts.append(conf)
    return unresolved_conflicts


def adjust_patch_level(target_path, common_path, diff):
    n = len(target_path)
    assert common_path[:n] == target_path
    if n == len(target_path):
        return diff
    remainder_path = tuple(reversed(common_path[n:]))
    newdiff = []
    for d in diff:
        nd = d
        assert nd is not None
        for key in remainder_path:
            nd = op_patch(key, nd)
        newdiff.append(nd)
    return newdiff


def collect_diffs(path, decisions):
    local_diff = []
    remote_diff = []
    for d in decisions:
        ld = adjust_patch_level(path, d.common_path, d.local_diff)
        rd = adjust_patch_level(path, d.common_path, d.remote_diff)
        local_diff.extend(ld)
        remote_diff.extend(rd)
    local_diff = combine_patches(local_diff)
    remote_diff = combine_patches(remote_diff)
    return local_diff, remote_diff


def collect_conflicting_diffs(path, decisions):
    local_conflict_diffs = []
    remote_conflict_diffs = []
    for d in decisions:
        if d.conflict:
            ld = adjust_patch_level(path, d.common_path, d.local_diff)
            rd = adjust_patch_level(path, d.common_path, d.remote_diff)
            local_conflict_diffs.extend(ld)
            remote_conflict_diffs.extend(rd)
    return local_conflict_diffs, remote_conflict_diffs


def collect_unresolved_diffs(base_path, unresolved_conflicts):
    """Collect local and remote diffs from conflict tuples.

    Assumed to be on the same path."""

    # Collect diffs
    local_conflict_diffs = []
    remote_conflict_diffs = []
    for conf in unresolved_conflicts:
        (path, ld, rd, strategy) = conf

        assert base_path == path
        #assert base_path == path[:len(base_path)]
        #relative_path = path[len(base_path):]
        #assert not relative_path

        assert isinstance(ld, list)
        assert isinstance(rd, list)

        for d in ld:
            local_conflict_diffs.append(d)
        for d in rd:
            remote_conflict_diffs.append(d)

    # Combine patches into canonical tree again
    local_conflict_diffs = combine_patches(local_conflict_diffs)
    remote_conflict_diffs = combine_patches(remote_conflict_diffs)
    return local_conflict_diffs, remote_conflict_diffs


def chunkname(diffs):
    aname = ""
    pname = ""
    for e in diffs:
        if e.op == DiffOp.ADDRANGE:
            aname += "A"
        elif e.op == DiffOp.ADD:
            aname += "a"
        elif e.op == DiffOp.PATCH:
            pname += "P"
        elif e.op == DiffOp.REMOVERANGE:
            pname += "R"
        elif e.op == DiffOp.REMOVE:
            pname += "r"
        elif e.op == DiffOp.REPLACE:
            pname += "c"
    return aname, pname


# =============================================================================
#
# Autoresolve code follows
#
# =============================================================================

def resolve_strategy_inline_attachments(base_path, attachments, decisions):
    strategy = "inline-attachments"

    local_conflict_diffs, remote_conflict_diffs = collect_conflicting_diffs(base_path, decisions)

    # Drop conflict decisions
    decisions.decisions = [d for d in decisions if not d.conflict]

    # FIXME: Review this code.

    ldiffs_by_key = {d.key: d for d in local_conflict_diffs}
    rdiffs_by_key = {d.key: d for d in remote_conflict_diffs}
    conflict_keys = sorted(set(ldiffs_by_key) | set(rdiffs_by_key))

    for key in conflict_keys:
        # key is the attachment filename
        ld = ldiffs_by_key[key]
        rd = rdiffs_by_key[key]

        if ld.op == DiffOp.REMOVE:
            # If one side is removing and we have a conflict,
            # the other side did an edit and we keep that
            # but flag a conflict (TODO: Or don't flag conflict?)
            assert rd.op != DiffOp.REMOVE
            decisions.remote(base_path, ld, rd, conflict=True, strategy=strategy)
        elif rd.op == DiffOp.REMOVE:
            decisions.local(base_path, ld, rd, conflict=True, strategy=strategy)
        else:
            # Not merging attachment contents, but adding attachments
            # with new names LOCAL_oldname and REMOTE_oldname instead.

            base = attachments[key]

            if ld.op == DiffOp.ADD:
                assert rd.op == DiffOp.ADD
                local = ld.value
            elif ld.op == DiffOp.REPLACE:
                local = ld.value
            else:
                assert ld.op == DiffOp.PATCH
                local = patch(base, ld.diff)

            if rd.op == DiffOp.ADD:
                remote = rd.value
            elif rd.op == DiffOp.REPLACE:
                remote = rd.value
            else:
                assert rd.op == DiffOp.PATCH
                remote = patch(base, rd.diff)

            local_name = "LOCAL_" + key
            remote_name = "REMOTE_" + key

            custom_diff = []

            if local_name in attachments:
                nbdime.log.warning("Replacing previous conflicted attachment with filename '{}'".format(local_name))
                custom_diff += [op_replace(local_name, local)]
            else:
                custom_diff += [op_add(local_name, local)]

            if remote_name in attachments:
                nbdime.log.warning("Replacing previous conflicted attachment with filename '{}'".format(remote_name))
                custom_diff += [op_replace(remote_name, remote)]
            else:
                custom_diff += [op_add(remote_name, remote)]

            decisions.custom(base_path, ldiffs, rdiffs, custom_diff, conflict=True, strategy=strategy)


def output_marker(text):
    return nbformat.v4.new_output("stream", name="stderr", text=text)


def get_outputs_and_note(base, removes, patches):
    if removes:
        note = " <removed>"
        suboutputs = []
    elif patches:
        e, = patches  # 0 or 1 item

        # Collect which mime types are modified
        mkeys = set()
        keys = set()
        for d in e.diff:
            if d.key == "data":
                assert d.op == DiffOp.PATCH
                for f in d.diff:
                    mkeys.add(f.key)
            else:
                keys.add(d.key)
        data = base.get("data")
        if data:
            ukeys = set(data.keys()) - mkeys
        else:
            ukeys = ()

        notes = []
        if mkeys or keys:
            notes.append("modified: {}".format(", ".join(sorted(mkeys))))
        if ukeys:
            notes.append("unchanged: {}".format(", ".join(sorted(ukeys))))
        if notes:
            note = " <" + "; ".join(notes) + ">"
        else:
            note = ""

        suboutputs = [patch(base, e.diff)]
    else:
        note = " <unchanged>"
        suboutputs = [base]
    return suboutputs, note


def make_inline_output_conflict(base_output, local_diff, remote_diff):
    """Make a list of outputs with conflict markers from conflicting
    local and remote diffs applying to a single base_output"""
    # Styling details
    base_title = "base"
    local_title = "local"
    remote_title = "remote"
    marker_size = 7  # default in git
    m0 = "<"*marker_size
    m1 = "|"*marker_size
    m2 = "="*marker_size
    m3 = ">"*marker_size

    # Split diffs by type
    d0 = local_diff
    d1 = remote_diff
    lpatches = [e for e in d0 if e.op == DiffOp.PATCH]
    rpatches = [e for e in d1 if e.op == DiffOp.PATCH]
    linserts = [e for e in d0 if e.op == DiffOp.ADDRANGE]
    rinserts = [e for e in d1 if e.op == DiffOp.ADDRANGE]
    lremoves = [e for e in d0 if e.op == DiffOp.REMOVERANGE]
    rremoves = [e for e in d1 if e.op == DiffOp.REMOVERANGE]
    assert len(lpatches) + len(linserts) + len(lremoves) == len(d0)
    assert len(rpatches) + len(rinserts) + len(rremoves) == len(d1)

    # Collect new outputs with surrounding markers
    outputs = []

    # Collect inserts from both sides separately
    if linserts or rinserts:
        lnote = ""
        loutputs = []
        for e in linserts:  # 0 or 1 item
            loutputs.extend(e.valuelist)
        rnote = ""
        routputs = []
        for e in rinserts:  # 0 or 1 item
            routputs.extend(e.valuelist)

        outputs.append(output_marker("%s %s%s\n" % (m0, local_title, lnote)))
        outputs.extend(loutputs)
        outputs.append(output_marker("%s\n" % (m2,)))
        outputs.extend(routputs)
        outputs.append(output_marker("%s %s%s\n" % (m3, remote_title, rnote)))

    # Keep base output if untouched (only inserts)
    keep_base = not (lremoves or rremoves or lpatches or rpatches)
    if lremoves and rremoves:
        # Don't add anything
        pass
    elif not keep_base:
        assert not (lremoves and lpatches)
        assert not (rremoves and rpatches)
        lnote = ""
        rnote = ""

        # Insert changed output with surrounding markers
        loutputs, lnote = get_outputs_and_note(base_output, lremoves, lpatches)
        routputs, rnote = get_outputs_and_note(base_output, rremoves, rpatches)

        outputs.append(output_marker("%s %s%s\n" % (m0, local_title, lnote)))
        outputs.extend(loutputs)
        outputs.append(output_marker("%s\n" % (m2,)))
        outputs.extend(routputs)
        outputs.append(output_marker("%s %s%s\n" % (m3, remote_title, rnote)))

    # Return marked up output
    return outputs, keep_base


def resolve_strategy_remove_outputs(base_path, outputs, decisions):
    strategy = "remove"

    decisions_by_index = bundle_decisions_by_index(base_path, decisions)
    decisions.decisions = []
    for key, decs in sorted(decisions_by_index.items()):
        if not any(d.conflict for d in decs):
            decisions.decisions.extend(decs)
        else:
            # Replace all decisions affecting key with resolution
            local_diff, remote_diff = collect_diffs(base_path, decs)
            if (
                len(local_diff) == len(remote_diff) == 1 and
                local_diff[0].op == remote_diff[0].op == DiffOp.ADDRANGE
            ):
                # remove in add vs add is a no-op
                custom_diff = []
            else:
                custom_diff = [op_removerange(key, 1)]
            decisions.custom(base_path, local_diff, remote_diff,
                custom_diff, conflict=False, strategy=strategy)


def resolve_strategy_inline_outputs(base_path, outputs, decisions):
    strategy = "inline-outputs"

    decisions_by_index = bundle_decisions_by_index(base_path, decisions)
    decisions.decisions = []
    for key, decs in sorted(decisions_by_index.items()):
        if not any(d.conflict for d in decs):
            decisions.decisions.extend(decs)
        else:
            # Replace all decisions affecting key with resolution
            local_diff, remote_diff = collect_diffs(base_path, decs)
            inlined_conflict, keep_base = make_inline_output_conflict(
                outputs[key], local_diff, remote_diff)
            custom_diff = []
            custom_diff += [op_addrange(key, inlined_conflict)]
            if not keep_base:
                custom_diff += [op_removerange(key, 1)]
            decisions.custom(base_path, local_diff, remote_diff, custom_diff, conflict=True, strategy=strategy)


def resolve_strategy_record_conflicts(base_path, base, decisions):
    strategy = "record-conflict"

    decisions.decisions = [push_patch_decision(d, d.common_path[len(base_path):]) for d in decisions]

    local_conflict_diffs, remote_conflict_diffs = collect_conflicting_diffs(base_path, decisions)
    #local_diff, remote_diff = collect_diffs(base_path, decisions)

    local_conflict_diffs = combine_patches(local_conflict_diffs)
    remote_conflict_diffs = combine_patches(remote_conflict_diffs)

    # Drop conflict decisions
    conflict_decisions = [d for d in decisions if d.conflict]
    decisions.decisions = [d for d in decisions if not d.conflict]

    # Record remaining conflicts in field nbdime-conflicts
    conflicts_dict = {
        "local_diff": local_conflict_diffs,
        "remote_diff": remote_conflict_diffs,
        # TODO: Record local and remote versions of full metadata, easier to manually select one?
        #"base_metadata": base,
        #"local_metadata": patch(base, local_diff),
        #"remote_metadata": patch(base, remote_diff),
    }
    if "nbdime-conflicts" in base:
        nbdime.log.warning("Replacing previous nbdime-conflicts field from base notebook.")
        op = op_replace("nbdime-conflicts", conflicts_dict)
    else:
        nbdime.log.warning("Recording unresolved conflicts in {}/nbdime-conflicts.".format(join_path(base_path)))
        op = op_add("nbdime-conflicts", conflicts_dict)
    custom_diff = [op]

    decisions.custom(base_path, local_conflict_diffs, remote_conflict_diffs, custom_diff, conflict=True, strategy=strategy)


def resolve_strategy_inline_source(path, base, local_diff, remote_diff):
    strategy = "inline-source"

    decisions = MergeDecisionBuilder()

    if local_diff is ParentDeleted:
        # Add marker at top of cell, easier to clean up manually
        local_diff = [op_addrange(0, ["<<<<<<< LOCAL CELL DELETED >>>>>>>\n"])]
        decisions.local_then_remote(path, local_diff, remote_diff, conflict=True, strategy=strategy)
    elif remote_diff is ParentDeleted:
        # Add marker at top of cell, easier to clean up manually
        remote_diff = [op_addrange(0, ["<<<<<<< REMOTE CELL DELETED >>>>>>>\n"])]
        decisions.remote_then_local(path, local_diff, remote_diff, conflict=True, strategy=strategy)
    else:
        # This is another approach, replacing content with markers
        # if local_diff is ParentDeleted:
        #     local = "<CELL DELETED>"
        # else:
        #     local = patch(base, local_diff)
        # if remote_diff is ParentDeleted:
        #     remote = "<CELL DELETED>"
        # else:
        #     remote = patch(base, remote_diff)

        # Run merge renderer on full sources
        local = patch(base, local_diff)
        remote = patch(base, remote_diff)
        merged, status = merge_render(base, local, remote, None)
        conflict = status != 0

        assert path[-1] == "source"
        custom_diff = [op_replace(path[-1], merged)]
        decisions.custom(path[:-1],
            [op_patch(path[-1], local_diff)],
            [op_patch(path[-1], remote_diff)],
            custom_diff, conflict=conflict, strategy=strategy)

    return decisions


def resolve_strategy_generic(path, decisions, strategy):
    if not (strategy and strategy != "mergetool" and decisions.has_conflicted()):
        return

    if strategy.startswith("use-"):
        # Example: /cells strategy use-local,
        # patch/remove conflict on /cells/3,
        # decision is changed to action=local
        action = strategy.replace("use-", "")
        for d in decisions:
            # Resolve conflicts that aren't marked with an
            # already applied strategy. This applies to
            # at least the inline conflict strategies.
            if d.conflict and not d.get("strategy"):
                d.action = action
                d.conflict = False
    else:
        msg = "Unexpected strategy {} on {}.".format(
            strategy, join_path(path))
        nbdime.log.error(msg)


def resolve_conflicted_decisions_list(path, base, decisions, strategy):
    if not (strategy and strategy != "mergetool" and decisions.has_conflicted()):
        return

    if strategy == "inline-outputs":
        # Affects conflicts on output dicts at /cells/*/outputs
        resolve_strategy_inline_outputs(path, base, decisions)

    elif strategy == "remove":
        # Affects conflicts on output dicts at /cells/*/outputs
        resolve_strategy_remove_outputs(path, base, decisions)

    elif strategy == "clear-all":
        # Old approach that relies on special handling in apply_decisions
        # to deal with clear-all overriding other decisions:
        # Collect local diffs and remote diffs from unresolved_conflicts
        #local_conflict_diffs, remote_conflict_diffs = collect_conflicting_diffs(path, decisions)
        #decisions.add_decision(path, "clear_all", local_conflict_diffs, remote_conflict_diffs, conflict=False)

        # Just drop all decisions and add a decision to remove the entire range
        local_diff, remote_diff = collect_diffs(path, decisions)
        custom_diff = [op_removerange(0, len(base))]
        decisions.decisions = []
        decisions.custom(path, local_diff, remote_diff, custom_diff, conflict=False, strategy=strategy)

    elif strategy == "clear":
        # FIXME: Only getting here when base is a list of the lines in a string,
        # actually resolved in resolve_conflicted_decisions_strings
        # Avoid error message in generic
        pass

    else:
        resolve_strategy_generic(path, decisions, strategy)


def resolve_conflicted_decisions_dict(path, base, decisions, strategy):
    if not (strategy and strategy != "mergetool" and decisions.has_conflicted()):
        return

    if strategy == "record-conflict":
        # affects conflicts on dicts at /***/metadata or below
        resolve_strategy_record_conflicts(path, base, decisions)

    elif strategy == "inline-attachments":
        # affects conflicts on string at /cells/*/attachments or below
        resolve_strategy_inline_attachments(path, base, decisions)

    else:
        resolve_strategy_generic(path, decisions, strategy)


def resolve_conflicted_decisions_strings(path, decisions, strategy):
    if not (strategy and strategy != "mergetool" and decisions.has_conflicted()):
        return

    if strategy == "clear":
        for d in decisions:
            if d.conflict and not d.get("strategy"):
                d.action = "clear"
                d.conflict = False
    elif strategy == "inline-source":
        # Avoid error message in generic
        pass
    else:
        resolve_strategy_generic(path, decisions, strategy)


# Thinking through conflict resolution:
# - when conflict first encountered, it's registered as dec.conflict(path, ..., strategy)
# - strategy is used in tryresolve and eventually dropped if a conflict is registered
# - when recursing and subdecisions are returned, they're added to decisions at this level
# - i.e. decisions at this point contains all conflicts not resolved for subdocument,
#   as well as unresolved conflicts for this level
# - if we have a strategy at this level, we can try to resolve all
#   conflicts of subdocument as well as those at this level


# =============================================================================
#
# Decision-making code follows
#
# =============================================================================

def _merge_dicts(base, local_diff, remote_diff, path, parent_decisions, strategies):
    """Perform a three-way merge of dicts. See docstring of merge."""
    assert isinstance(base, dict)

    # Get base path for strategy lookup
    spath = star_path(path)

    # Get strategy for this dict (parent of items processed below)
    dict_strategy = strategies.get(spath)

    transients = strategies.transients

    decisions = MergeDecisionBuilder()

    # Intermediate list of conflicts recorded during first pass over diffs,
    # resolution will be attempted at the end here
    conflicts = []

    local_diff = as_dict_based_diff(local_diff)
    remote_diff = as_dict_based_diff(remote_diff)

    # Summary of diff entry cases with (#) references to below code
    # r\l | N/A   -   +   :   !
    # ----|----------------------
    # N/A | (1)  (2)---------(2)
    #  -  | (3)  (4) (5)-----(5)
    #  +  |  |   (5) (6) (5) (5)
    #  :  |  |    |  (5) (7) (5)
    #  !  | (3)  (5) (5  (5) (8)

    # Get diff keys
    bldkeys = set(local_diff.keys())
    brdkeys = set(remote_diff.keys())
    dkeys = bldkeys | brdkeys

    # (1) Use base values for all keys with no change
    for key in sorted(set(base.keys()) - dkeys):
        pass

    # (2)-(3) Apply one-sided diffs
    for key in sorted(bldkeys ^ brdkeys):
        decisions.onesided(path,
                           local_diff.get(key),
                           remote_diff.get(key))

    # (4) (5) (6) (7) (8)
    # Then we have the potentially conflicting changes
    for key in sorted(brdkeys & bldkeys):
        # Get diff entries for this key (we know both sides have an
        # entry here because all other cases are covered above)
        ld = local_diff[key]
        rd = remote_diff[key]

        # Get values (using Missing as a sentinel to allow None as a value)
        bv = base.get(key, Missing)

        # Get strategy for this key
        item_path = path + (key,)
        item_spath = "/".join((spath, key))
        item_strategy = strategies.get(item_spath)

        # Long if-else structure follows with actions for
        # combinations of local and remote operations
        if ld.op == "parent_deleted":
            # Recurse to apply strategy countering parent deletion
            assert rd.op == DiffOp.PATCH
            subdecisions = _merge(bv, ParentDeleted, rd.diff, item_path, decisions, strategies)
            decisions.extend(subdecisions)
        elif rd.op == "parent_deleted":
            # Recurse to apply strategy countering parent deletion
            assert ld.op == DiffOp.PATCH
            subdecisions = _merge(bv, ld.diff, ParentDeleted, item_path, decisions, strategies)
            decisions.extend(subdecisions)
        elif ld.op == DiffOp.REMOVE or rd.op == DiffOp.REMOVE:
            if ld.op == DiffOp.REMOVE and rd.op == DiffOp.REMOVE:
                # (4) Removed in both local and remote
                decisions.agreement(path, ld, rd)
            elif ld.op == DiffOp.REMOVE and is_diff_all_transients([rd], path, transients):
                # If one side is deleted and the other only transients,
                # drop the transient diffs and let parent pick the deletion
                decisions.local(path, ld, rd)
            elif rd.op == DiffOp.REMOVE and is_diff_all_transients([ld], path, transients):
                # If one side is deleted and the other only transients,
                # drop the transient diffs and let parent pick the deletion
                decisions.remote(path, ld, rd)
            else:
                # (5) Conflict: removed one place and edited another
                # TODO: use will_diff_counter_parent_deletion as in _merge_lists
                #   if it becomes relevant: currently only cell deletion can be countered
                decisions.conflict(path, [ld], [rd], item_strategy)
        elif ld.op != rd.op:
            # Note that this means the below cases always have the same op
            # (5) Conflict: edited in different ways
            decisions.conflict(path, [ld], [rd], item_strategy)
        elif ld == rd:
            # If inserting/replacing/patching produces the same value, just use
            # it
            decisions.agreement(path, ld, rd)
        elif ld.op == DiffOp.ADD:
            # (6) Insert in both local and remote, values are different
            # This can possibly be resolved by recursion
            # TODO: consider merging added values
            decisions.conflict(path, [ld], [rd], item_strategy)
        elif ld.op == DiffOp.REPLACE:
            # (7) Replace in both local and remote, values are different,
            #     record a conflict against original base value
            decisions.conflict(path, [ld], [rd], item_strategy)
        elif ld.op == DiffOp.PATCH:
            # (8) Patch on both local and remote, values are different
            # Patches produce different values, try merging the substructures
            # (a patch command only occurs when the type is a collection, so we
            # can safely recurse here and know we won't encounter e.g. an int)
            subdecisions = _merge(bv, ld.diff, rd.diff, item_path, decisions, strategies)
            decisions.extend(subdecisions)
        else:
            raise ValueError("Invalid diff ops {} and {}.".format(ld.op, rd.op))

    # Resolve remaining conflicts with strategy at this level if any
    resolve_conflicted_decisions_dict(path, base, decisions, dict_strategy)
    return decisions


def _split_addrange(key, local, remote, path, item_strategy):
    """Compares two addrange value lists, and splits decisions on similarity

    Uses diff of value lists to identify which items to align. Identical,
    aligned inserts are decided as in agreement, while inserts that are aligned
    without being identical are treated as conflicts (possibly to be resolved
    by autoresolve). Non-aligned inserts are treated as conflict free,
    one-sided inserts.
    """
    # First, find diff between local and remote insertion values.
    # This will align common subsequences according to the similarity
    # measures defined in notebook predicates.
    intermediate_diff = diff(local, remote, path=star_path(path),
                             predicates=notebook_predicates.copy(),
                             differs=notebook_differs.copy())

    # Next, translate the diff into decisions
    decisions = MergeDecisionBuilder()
    taken = 0
    offset = 0  # Offset between diff keys (ref local) and remote
    i = 0
    while i < len(intermediate_diff):
        d = intermediate_diff[i]

        assert d.key >= taken

        # No diff in the range [taken,d.key), which means elements are inserted on both sides
        if taken < d.key:
            overlap = [op_addrange(key, local[taken:d.key])]
            decisions.agreement(path, overlap, overlap)
            taken = d.key

        # Either (1) conflicted, (2) local onesided, or (3) remote onesided
        # First checks whether the next op is a removal on the same key
        # as the current one (i.e. a range substitution).
        if (i + 1 < len(intermediate_diff) and
                intermediate_diff[i+1].op == DiffOp.REMOVERANGE and
                intermediate_diff[i+1].key == d.key):
            # This indicates a non-similar sub-sequence, according
            # to the predicates.
            # (1) Conflicted addition
            local_len = intermediate_diff[i+1].length
            ld = [op_addrange(key, local[d.key:d.key+local_len])]
            rd = [op_addrange(key, d.valuelist)]
            decisions.conflict(path, ld, rd, item_strategy)
            offset += len(d.valuelist) - local_len
            # (*) Here we treat two ops in one go, which we mark
            # by setting taken beyond the key of the next op:
            taken += local_len
            # Skip diff i+1
            i += 1

        elif d.op == DiffOp.REPLACE:
            # Same as above, but length of one, so simpler
            # (1) Conflict (one element each)
            ld = [op_addrange(key, [local[d.key]])]
            rd = [op_addrange(key, [d.value])]
            decisions.conflict(path, ld, rd, item_strategy)
            taken += 1

        elif d.op in (DiffOp.REMOVE, DiffOp.REMOVERANGE):
            # (2) Local onesided
            if d.op == DiffOp.REMOVE:
                vl = [local[d.key]]
            else:
                vl = local[d.key:d.key + d.length]
            decisions.onesided(path, [op_addrange(key, vl)], [])
            offset -= len(vl)
            taken += len(vl)

        elif d.op in (DiffOp.ADD, DiffOp.ADDRANGE):
            # (3) Remote onesided
            if d.op == DiffOp.ADD:
                vl = [d.value]
            else:
                vl = d.valuelist
            decisions.onesided(path, None, [op_addrange(key, vl)])
            offset += len(vl)

        elif d.op == DiffOp.PATCH:
            # Predicates indicate that local and remote items are similar!
            decisions.conflict(path,
                [op_addrange(key, [local[d.key]])],
                [op_addrange(key, [remote[d.key + offset]])],
                item_strategy)
            taken += 1

        else:
            raise ValueError("Invalid diff op: %s" % d.op)

        # Increment to next diff
        i += 1

    # If remote has additional items at the end, that will
    # be an addrange in the diff and handled above.
    # If local has additional items at the end, that's
    # a removerange in the diff and handled above.
    # If both have equal items at the end, that's not
    # part of the diff so handle it here.
    if taken < len(local):
        # Have elements that are inserted on both sides
        local_items = local[taken:]
        remote_items = remote[taken-len(local)+len(remote):]
        # TODO: Do we need global debug flags to turn
        # off potentially expensive assertions like this?
        assert local_items == remote_items
        overlap = [op_addrange(key, local_items)]
        decisions.agreement(path, overlap, overlap)

    return decisions


def _merge_concurrent_inserts(base, ldiff, rdiff, path, decisions, item_strategy):
    """Merge concurrent inserts, optionally with one or more removeranges.

    This method compares the addition/removals on both sides, and splits it
    into individual agreement/onesided/conflict decisions.
    """
    # Assume first diffops are always addranges and optional second diffop is a removerange
    assert 1 <= len(ldiff) <= 2
    assert 1 <= len(rdiff) <= 2
    assert ldiff[0].op == DiffOp.ADDRANGE and rdiff[0].op == DiffOp.ADDRANGE
    assert len(ldiff) == 1 or ldiff[1].op == DiffOp.REMOVERANGE
    assert len(rdiff) == 1 or rdiff[1].op == DiffOp.REMOVERANGE

    subdecisions = _split_addrange(ldiff[0].key,
        ldiff[0].valuelist, rdiff[0].valuelist,
        path, item_strategy)

    # If there are any conflicts in the merging, and removals following...
    if subdecisions.has_conflicted() and (len(ldiff) == 2 or len(rdiff) == 2):
        # ... throw away subdecisions here and mark entire thing as conflicted
        decisions = MergeDecisionBuilder()
        decisions.conflict(path, ldiff, rdiff, item_strategy)
    else:
        # ... otherwise use decisions from merging of inserted values, and if
        # there are removals at the end, add them without conflict
        decisions = subdecisions
        if len(ldiff) == 2 and len(rdiff) == 2:
            # Same length removals ensured by chunking
            assert ldiff[1].length == rdiff[1].length
            decisions.agreement(path, ldiff[1:], rdiff[1:])
        elif len(ldiff) == 2 or len(rdiff) == 2:
            decisions.onesided(path, ldiff[1:], rdiff[1:])

    return decisions


def _merge_lists(base, local_diff, remote_diff, path, parent_decisions, strategies):
    """Perform a three-way merge of lists. See docstring of merge."""
    assert isinstance(base, list)

    # Get base path for strategy lookup
    spath = star_path(path)
    item_spath = "/".join((spath, "*"))

    # Get strategy for this list (parent of items processed below)
    list_strategy = strategies.get(spath)
    item_strategy = strategies.get(item_spath)

    transients = strategies.transients

    decisions = MergeDecisionBuilder()

    # Intermediate list of conflicts recorded during first pass over diffs,
    # resolution will be attempted at the end here
    #conflicts = []

    # Split up and combine diffs into chunks
    # format: [(begin, end, localdiffs, remotediffs)]
    chunks = make_merge_chunks(base, local_diff, remote_diff)

    # Loop over chunks of base[j:k], grouping insertion at j into
    # the chunk starting with j
    for (key, chunk_end, d0, d1) in chunks:
        item_path = path + (key,)

        # Split local and remote diffs (d0 and d1) into their addrange and remainder (patch/removerange)
        # These are accessed in a lot of different combinations below
        a0 = [e for e in d0 if e.op == DiffOp.ADDRANGE]  # local addrange (0 or 1)
        p0 = [e for e in d0 if e.op != DiffOp.ADDRANGE]  # local patch or removerange (0 or 1)
        a1 = [e for e in d1 if e.op == DiffOp.ADDRANGE]  # remote addrange (0 or 1)
        p1 = [e for e in d1 if e.op != DiffOp.ADDRANGE]  # remote patch or removerange (0 or 1)

        # Build chunk names, easier to compare these strings
        # below than inspecting the diffs again and again
        laname, lpname = chunkname(d0)
        raname, rpname = chunkname(d1)
        lname = laname + lpname
        rname = raname + rpname
        # /, A/, /A, A/A depending on addrange local and/or remote: 
        achunktype = laname + "/" + raname
        # Combinations of P (patch), R (removerange), or '',
        # e.g. P/R for local patch, remote removerange
        pchunktype = lpname + "/" + rpname
        # Combines achunktype and pchunktype,
        # e.g. AP/AR for local addrange+patch, remote addrange+removerange
        chunktype = lname + "/" + rname

        # ... The rest of this function is a big if-elif-elif 'switch'

        # Unmodified chunk
        if chunktype == "/":
            pass   # No-op

        # One-sided modification of chunk
        elif not (bool(d0) and bool(d1)):
            decisions.onesided(path, d0, d1)

        # Exactly the same modifications
        elif d0 == d1:
            decisions.agreement(path, d0, d1)

        # Should always agree above because of chunking
        elif chunktype == "R/R":
            nbdime.log.error("Not expecting conflicting two-sided removal at this point.")

        # Workaround for string merge
        elif isinstance(base, string_types) and chunktype == "AP/AP":
            # If we get here, base is a single line from a parent multiline string.

            # item_strategy points to characters, list_strategy points to lines,
            # we might rather want parent_strategy?
            parent_strategy = strategies.get(star_path(path[:-1]))

            # In these cases, simply merge the As, then consider patches after
            subdecisions = _merge_concurrent_inserts(
                base, a0, a1, path, decisions, parent_strategy)
            decisions.extend(subdecisions)

            # For string base, replace patches with add/remove line
            # TODO: This is intended as a short term workaround until
            # more robust chunking of strings are included
            bv = base[key]
            lv = patch(bv, d0[1].diff)
            rv = patch(bv, d1[1].diff)
            p0 = [op_addrange(key, [lv]), op_removerange(key, 1)]
            p1 = [op_addrange(key, [rv]), op_removerange(key, 1)]
            if lv == rv:
                decisions.agreement(item_path, p0, p1)
            else:
                decisions.conflict(item_path, p0, p1, parent_strategy)

        # Patch/remove conflicts (with or without prior insertion)
        elif pchunktype in ("P/P", "P/R", "R/P"):
            # Deal with prior insertion first
            if achunktype == "A/A":
                # In these cases, simply merge the As, then consider patches after
                subdecisions = _merge_concurrent_inserts(
                    base, a0, a1, path, decisions, item_strategy)
                decisions.extend(subdecisions)
            elif achunktype in ("A/", "/A"):
                # Onesided addition + conflicted patch/remove
                decisions.onesided(path, a0, a1)

            # Then deal with patches and/or removals
            if p0 == p1:
                decisions.agreement(path, p0, p1)
            elif pchunktype == "P/P":
                # Otherwise recurse and pass on unresolved conflicts
                subdecisions = _merge(
                    base[key], p0[0].diff, p1[0].diff,
                    item_path, decisions, strategies)
                decisions.extend(subdecisions)
            else:  # P/R or R/P
                # Recurse into patches but with ParentDeleted sentinel passed instead of the diff
                if p0[0].op == DiffOp.PATCH:
                    thediff = p0[0].diff
                elif p1[0].op == DiffOp.PATCH:
                    ldiff = ParentDeleted
                    thediff = p1[0].diff
                else:
                    nbdime.log.error("Unexpected op combination at this point.")

                # If this is not true here, we need to add a
                # decision to remove the rest of the items
                if p0[0].op == DiffOp.REMOVERANGE:
                    assert p0[0].length == 1
                if p1[0].op == DiffOp.REMOVERANGE:
                    assert p1[0].length == 1

                # Possible results of a ParentDeleted / patch situation:
                #   - patch contains only transient changes and can be discarded (generic behaviour)
                #   - recurse and take ParentDeleted into account, making custom decisions (inline behaviour)
                #   - add conflict decision on parent and leave it at that (mergetool behaviour)
                is_transient = is_diff_all_transients(thediff, item_path, transients)

                if p0[0].op == DiffOp.REMOVERANGE and is_transient:
                    # Patch contains only transient changes, pick deletion
                    decisions.local(path, p0, p1)
                elif p1[0].op == DiffOp.REMOVERANGE and is_transient:
                    # Patch contains only transient changes, pick deletion
                    decisions.remote(path, p0, p1)
                elif list_strategy == "use-base":
                    # Not sure if this will be used, it just makes sense here
                    decisions.base(path, p0, p1)
                elif list_strategy == "use-local":
                    # Not sure if this will be used, it just makes sense here
                    decisions.local(path, p0, p1)
                elif list_strategy == "use-remote":
                    # Not sure if this will be used, it just makes sense here
                    decisions.remote(path, p0, p1)
                elif will_diff_counter_parent_deletion(thediff, item_path, strategies):
                    # Keep the deleted item and instead let strategies for
                    # subobjects record that there has been a conflict
                    counterdiff = create_parent_deletion_counter_diff(thediff, item_path, strategies)
                    if p0[0].op == DiffOp.REMOVERANGE:
                        ld, rd = counterdiff, thediff
                    else:
                        assert p1[0].op == DiffOp.REMOVERANGE
                        ld, rd = thediff, counterdiff
                    subdecisions = _merge(
                        base[key], ld, rd,
                        item_path, decisions, strategies)
                    decisions.extend(subdecisions)
                else:
                    # Add conflict decision on parent and leave it at that (mergetool behaviour)
                    decisions.conflict(path, p0, p1, item_strategy)  # FIXME: Right strategy?

            # ... end pchunktypes P/P, P/R, R/P
        # Insert before patch or remove: apply both but mark as conflicted
        elif chunktype in ("A/P", "A/R"):
            action = decisions.tryresolve(path, d0, d1, item_strategy)
            if not action:
                decisions.local_then_remote(path, d0, d1, conflict=True)
        elif chunktype in ("P/A", "R/A"):
            action = decisions.tryresolve(path, d0, d1, item_strategy)
            if not action:
                decisions.remote_then_local(path, d0, d1, conflict=True)

        # Merge insertions from both sides and add onesided patch afterwards
        elif chunktype in ("A/AP", "AP/A"):
            # Not including patches in merging of inserts
            subdecisions = _merge_concurrent_inserts(
                base, a0, a1, path, decisions, item_strategy)
            decisions.extend(subdecisions)
            decisions.onesided(path, p0, p1)

        # Variations of range substitutions
        elif chunktype in ("AR/R", "R/AR"):
            # Identical (ensured by chunking) twosided removal with insertion just before one of them
            decisions.onesided(path, a0, a1)
            decisions.agreement(path, p0, p1)
        elif chunktype in ("AR/A", "A/AR", "A/A", "AR/AR"):
            # Including removals in merging of inserts
            subdecisions = _merge_concurrent_inserts(
                base, d0, d1, path, decisions, item_strategy)
            decisions.extend(subdecisions)
        else:
            assert nbdime.log.error("Unhandled chunk conflict type %s" % (chunktype,))

    # Resolve remaining conflicts with strategy at this level if any
    #resolve_transients(path, base, decisions, transients)
    resolve_conflicted_decisions_list(path, base, decisions, list_strategy)
    return decisions


def _merge_strings(base, local_diff, remote_diff,
                   path, parent_decisions, strategies):
    """Perform a three-way merge of strings. See docstring of merge."""
    assert isinstance(base, string_types)

    # This functions uses a (static) state variable to track recursion.
    # The first time it is called, base can (potentially) be a
    # multi-line string. If so, we split this string on line endings, and merge
    # it as a list of lines (giving line-based chunking). However, if
    # there are conflicting edits (patches) of a line, we will re-enter this
    # function. If so, we simply mark it as conflicted lines.
    if _merge_strings.recursion:
        # base is a single line with differing edits. We could merge as list of
        # characters, but this is unreliable, and will conflict with line-based
        # chunking.
        decisions = MergeDecisionBuilder()

        # Get strategy for the parent string (path points to line)
        strategy = strategies.get(star_path(path[:-1]))

        # Mark as a conflict on parent (line):
        linenumber = path[-1]
        decisions.conflict(path[:-1],
            [op_patch(linenumber, local_diff)],
            [op_patch(linenumber, remote_diff)],
            strategy)
    else:
        # Get strategy for this string
        strategy = strategies.get(star_path(path))

        # For inline-source, we avoid trying to
        # resolve our own diffs at all and leave
        # the work to the merge conflict renderer
        # (possibly git merge-file or diff3)
        if strategy == "inline-source":
            decisions = resolve_strategy_inline_source(
                path, base, local_diff, remote_diff)
        else:
            # FIXME XXX: Test regular string merge well also for no specific strategy!

            # Merge lines as lists
            base_lines = base.splitlines(True)
            _merge_strings.recursion = True
            try:
                decisions = _merge_lists(
                    base_lines, local_diff, remote_diff,
                    path, parent_decisions, strategies)
            finally:
                # Ensure recursion stops even in case of exceptions
                _merge_strings.recursion = False
        #elif strategy == "union":
        #    nbdime.log.error("union strategy not implemented for source")  # FIXME
        # TODO: Add option to try git merge-file or diff3 even when using mergetool
        #elif strategy == "try-external":
        #    nbdime.log.error("try-external strategy is not implemented")
        resolve_conflicted_decisions_strings(path, decisions, strategy)

    if any([decisions.decisions[i] == decisions.decisions[j]
           for i in range(len(decisions.decisions))
           for j in range(len(decisions.decisions))
           if i != j]):
        nbdime.log.error("Found duplicated decisions, most likely a bug!")

    return decisions

_merge_strings.recursion = False


def _merge(base, local_diff, remote_diff, path, decisions, strategies):
    if isinstance(base, dict):
        return _merge_dicts(
            base, local_diff, remote_diff,
            path, decisions, strategies)
    elif isinstance(base, list):
        return _merge_lists(
            base, local_diff, remote_diff,
            path, decisions, strategies)
    elif isinstance(base, string_types):
        return _merge_strings(
            base, local_diff, remote_diff,
            path, decisions, strategies)
    else:
        raise ValueError("Cannot handle merge of type {}.".format(type(base)))


def decide_merge_with_diff(base, local, remote, local_diff, remote_diff, strategies=None):
    """Do a three-way merge of same-type collections b, l, r with given diffs
    b->l and b->r."""
    if strategies is None:
        strategies = Strategies({})

    path = ()

    parent_decisions = MergeDecisionBuilder()

    decisions = _merge(base,
        local_diff, remote_diff,
        path, parent_decisions, strategies)

    # This is a remnant of the previous design, I think we
    # can safely remove the parent_decisions argument now
    # in all the _merge* functions
    assert not parent_decisions

    # Apply root strategy to resolve remaining conflicts
    strategy = strategies.get("/")
    resolve_strategy_generic(path, decisions, strategy)

    # FIXME: Do this?
    #decisions.decisions = [pop_all_patch_decisions(d) for d in decisions]

    return decisions.validated(base)


def decide_merge(base, local, remote, strategies=None):
    """Do a three-way merge of same-type collections b, l, r.

    Terminology:

        collection = list | dict | string
        value = int | float | string

        (string is a collection of chars or an atomic value depending on parameters)

        (an alternative way to handle string parameters would be a pre/postprocessing
        splitting/joining of strings into lists of lines, lists of words, lists of chars)

    Input:

        b - base collection
        l - local collection
        r - remote collection
        bld - base-local diff
        brd - base-remote diff

    ### Output:

        md - list of merge decisions

    The merge result can be computed by applying the decisions to the base.
    If any decisions have the conflict field set to True, the merge result will
    use the suggested action, which might not always be correct.

    ## Trying to figure out problem with diff vs diff entry in recursion:

    decide_merge(b, l, r) -> compute bld,brd and call _merge
    _merge(b, bld, brd) -> switch on type of b,l,r
    _merge_dicts(b, bld, brd)
    _merge_lists(b, bld, brd)
    _merge_strings(b, bld, brd)

    Case: b,l,r are dicts, bld,brd are dict diffs, keys of bld,brd correspond to keys in b,l,r.
    Case: b,l,r are lists, bld,brd are list diffs, indices in bld,brd entries correspond to indices in b(,l,r).

    Case: purely nested dicts of values. Alternatives for each dict key:

        One sided ops always ok:
        N,-
        N,!
        N,:
        N,+
        -,N
        !,N
        :,N
        +,N

        Two sided equal ops ok if argument is the same:
        -,- = ok (agree on delete)
        +,+ = ok if equal inserts, otherwise conflict (two sided insert)
        !,! = ok if equal patches, otherwise conflict (two sided patch)
        :,: = ok if equal replacement value, otherwise conflict (two sided replace)

        Different op always conflicts:
        !,- = conflict (delete and patch)
        -,! = conflict (delete and patch)
        :,- = conflict (delete and replace)
        -,: = conflict (delete and replace)
        :,! = conflict (patch and replace)
        !,: = conflict (patch and replace)

        Conflict situations (symmetric, only listing from one side):
        delete / replace or delete / patch -- manual resolution needed
        replace / replace with different value -- manual resolution needed
        insert / insert with different value -- manual resolution needed - recursion will not have a base value for further merging.
        patch / patch with different diff -- recurse!
        replace / patch -- manual resolution needed, will only happen if collection type changes in replace


        Takeaways:
        - Ensure that diff always uses patch on collections unless the type changes and replace on values.
        - The only recursion will happen on the patch / patch op of equal type collections!
        - Patch op is [DiffOp.PATCH, key, subdiff], providing subdiff for both sides, and meaning values exist on both sides.


    ## Next trying to figure out list situations:

    Case: purely nested lists of values. Alternatives for each base item:

        One sided ops always ok:
        N,-
        N,+
        N,!

        Delete and patch is a conflict:
        -,! = conflict (delete and patch)

        Two sided equal ops ok if argument is the same:
        -,- = ok (agree on deleting this item)
        -,+ = ok (delete this item and insert new values)
        +,+ = ok (always insert both, or pick one if new values are equal?)
        !,! = ok (recurse)
        !,+ = ok (patch this item and insert new values)

        Conflict situations (symmetric, only listing from one side):
        delete / replace or delete / patch -- manual resolution needed
        replace / replace with different value -- manual resolution needed
        insert / insert with different value -- manual resolution needed - recursion will not have a base value for further merging.
        patch / patch with different diff -- recurse!
        replace / patch -- manual resolution needed, will only happen if collection type changes in replace

    """
    if strategies is None:
        strategies = Strategies({})
    local_diff = diff(base, local)
    remote_diff = diff(base, remote)
    return decide_merge_with_diff(base, local, remote, local_diff, remote_diff, strategies)
