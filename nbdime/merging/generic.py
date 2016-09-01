# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import unicode_literals

from six import string_types

from .decisions import MergeDecisionBuilder
from .chunks import make_merge_chunks
from ..diffing import diff
from ..diff_format import (DiffOp, as_dict_based_diff, op_patch, op_addrange)
from ..diffing.notebooks import notebook_predicates, notebook_differs
from ..utils import star_path


# Set to true to enable some expensive debugging assertions
DEBUGGING = 0

# Sentinel to allow None value
Missing = object()


# =============================================================================
#
# Decision-making code follows
#
# =============================================================================


def _merge_dicts(base, local_diff, remote_diff, path, decisions):
    """Perform a three-way merge of dicts. See docstring of merge."""
    assert isinstance(base, dict)

    # Converting to dict-based diff format for dicts for convenience
    # This step will be unnecessary if we change the diff format to work this
    # way always
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

        # Switch on diff ops
        lop = ld.op
        rop = rd.op
        if lop != rop:
            # Note that this means the below cases always have the same op
            # (5) Conflict: removed one place and edited another, or edited in
            #     different ways
            decisions.conflict(path, ld, rd)
        elif lop == DiffOp.REMOVE:
            # (4) Removed in both local and remote, just don't add it to merge
            #     result
            decisions.agreement(path, ld, rd)
        elif lop in (DiffOp.ADD, DiffOp.REPLACE, DiffOp.PATCH) and ld == rd:
            # If inserting/replacing/patching produces the same value, just use
            # it
            decisions.agreement(path, ld, rd)
        elif lop == DiffOp.ADD:
            # (6) Insert in both local and remote, values are different
            # This can possibly be resolved by recursion, but leave that to
            # autoresolve
            decisions.conflict(path, ld, rd)
        elif lop == DiffOp.REPLACE:
            # (7) Replace in both local and remote, values are different,
            #     record a conflict against original base value
            decisions.conflict(path, ld, rd)
        elif lop == DiffOp.PATCH:
            # (8) Patch on both local and remote, values are different
            # Patches produce different values, try merging the substructures
            # (a patch command only occurs when the type is a collection, so we
            # can safely recurse here and know we won't encounter e.g. an int)
            _merge(bv, ld.diff, rd.diff, path + (key,), decisions)
        else:
            raise ValueError("Invalid diff ops {} and {}.".format(lop, rop))


def _split_addrange_on_equality(key, local, remote, path):
    """Compares two addrange value lists, and splits decisions on similarity

    Uses diff of value lists to identify which items to align. Identical,
    aligned inserts are decided as in agreement, while inserts that are aligned
    without being identical are treated as conflicts. Non-aligned inserts are
    treated as conflict free, one-sided inserts.
    """
    # First, find diff between local and remote insertion values
    intermediate_diff = diff(local, remote, path=star_path(path),
                             predicates=notebook_predicates.copy(),
                             differs=notebook_differs.copy())

    # Next, translate the diff into decisions
    decisions = MergeDecisionBuilder()
    taken = 0
    offset = 0  # Offset between diff keys (ref local) and remote
    for i, d in enumerate(intermediate_diff):
        # NOTE: Important to separate passed key, and d.key!
        # All ops should happen on key, but order need to be correct
        if d.key < taken:
            continue
        if taken < d.key:
            # Have elements that are inserted on both sides
            overlap = [op_addrange(key, local[taken:d.key])]
            decisions.agreement(path, overlap, overlap)
            taken = d.key

        # Either (1) conflicted, (2) local onesided, or (3) remote onesided
        if (i + 1 < len(intermediate_diff) and
                intermediate_diff[i+1].op == DiffOp.REMOVERANGE and
                intermediate_diff[i+1].key == d.key):
            # (1) Conflicted addition
            local_len = intermediate_diff[i+1].length
            ld = [op_addrange(key, local[d.key:d.key+local_len])]
            rd = [op_addrange(key, d.valuelist)]
            decisions.conflict(path, ld, rd)
            offset += len(d.valuelist) - local_len
            taken += local_len
        elif d.op == DiffOp.REPLACE:
            # (1) Conflict (one element each)
            ld = [op_addrange(key, [local[d.key]])]
            rd = [op_addrange(key, [d.value])]
            decisions.conflict(path, ld, rd)
            taken += 1
        elif d.op in (DiffOp.REMOVE, DiffOp.REMOVERANGE):
            # (2) Local onesided
            if d.op == DiffOp.REMOVE:
                vl = [local[d.key]]
            else:
                vl = local[d.key:d.key + d.length]
            decisions.onesided(path, [op_addrange(key, vl)], None)
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
            # This means that local and remote are similar!
            # Mark as conflcit, and leave to autoresolve to deal with it
            decisions.conflict(path,
                               [op_addrange(key, local[d.key])],
                               [op_addrange(key, remote[d.key + offset])])
            taken += 1
        else:
            raise ValueError("Invalid diff op: %s" % d.op)

    # We have made at least one split
    if taken < len(local):
        # Have elements that are inserted on both sides
        overlap = [op_addrange(key, local[taken:])]
        decisions.agreement(path, overlap, overlap)
    if len(decisions.decisions) > 1 or not decisions.decisions[0].conflict:
        return decisions.decisions
    else:
        return None


def _merge_concurrent_inserts(base, ldiff, rdiff, path, decisions):
    """Merge concurrent inserts, optionally with one or more removeranges.

    This method compares the addition/removals on both sides, and splits it
    into individual agreement/onesided/conflict decisions.
    """
    assert ldiff[0].op == DiffOp.ADDRANGE and rdiff[0].op == DiffOp.ADDRANGE
    # First, reconstruct the value lists as they are on local and remote
    lv = ldiff[0].valuelist
    rv = rdiff[0].valuelist

    if len(ldiff) != len(rdiff):
        if len(ldiff) > len(rdiff):
            rv = rv + base[ldiff[1].key:ldiff[1].key + ldiff[1].length]
        elif len(rdiff) > len(ldiff):
            lv = lv + base[rdiff[1].key:rdiff[1].key + rdiff[1].length]
    subdec = _split_addrange_on_equality(ldiff[0].key, lv, rv, path)
    if subdec:
        decisions.decisions.extend(subdec)
        if len(ldiff) > 1 and len(rdiff) > 1:
            decisions.agreement(path, ldiff[1:], rdiff[1:])
        elif len(ldiff) > 1 or len(rdiff) > 1:
            decisions.onesided(path, ldiff[1:], rdiff[1:])
    else:
        decisions.conflict(path, ldiff, rdiff)


def _merge_lists(base, local_diff, remote_diff, path, decisions):
    """Perform a three-way merge of lists. See docstring of merge."""
    assert isinstance(base, list)

    # Split up and combine diffs into chunks
    # format: [(begin, end, localdiffs, remotediffs)]
    chunks = make_merge_chunks(base, local_diff, remote_diff)

    # Loop over chunks of base[j:k], grouping insertion at j into
    # the chunk starting with j
    for (j, k, d0, d1) in chunks:
        if not (bool(d0) or bool(d1)):
            # Unmodified chunk
            pass   # No-op

        elif not (bool(d0) and bool(d1)):
            # One-sided modification of chunk
            decisions.onesided(path, d0, d1)

        elif d0 == d1:
            # Exactly the same modifications
            decisions.agreement(path, d0, d1)

        # Below notation: A: addition, R: removal, P: patch
        # Double operations: AP and AR (addition followed by patch or removal)
        # 15 combinations to cover below:
        # A/R: addition on one side, removal on other
        # AR/R: addtion and removal on one side, removal on other
        # etc.
        # These can be partially resolved, except for the case of
        # AR/AR, which is basically a sequence replacement. These are often
        # complex enough that they are best left as conflicts!

        elif (len(d0) == len(d1) == 1 and
                not d0[0].op == d1[0].op == DiffOp.ADDRANGE):
            # A/R, A/P, R/P or P/P
            # (R/R will always agree above because of chunking)
            ld, rd = d0[0], d1[0]
            ops = (ld.op, rd.op)

            if ld.op == rd.op == DiffOp.PATCH:
                # P/P, recurse
                assert ld.key == rd.key
                key = ld.key
                bv = base[key]
                _merge(bv, ld.diff, rd.diff,
                       path + (key,), decisions)
            elif DiffOp.REMOVERANGE in ops and DiffOp.PATCH in ops:
                # R/P, always conflict
                decisions.conflict(path, d0, d1)
            else:
                # A/R or A/P, by eliminiation
                # Simply perform addition first, then patch/removal
                # Mark conflicted, as this is suspect
                assert DiffOp.ADDRANGE in ops
                if ld.op == DiffOp.ADDRANGE:
                    # Addition locally
                    decisions.local_then_remote(path, d0, d1, conflict=True)
                else:
                    # Addition remotely
                    decisions.remote_then_local(path, d0, d1, conflict=True)

        elif d0[0].op != d1[0].op:
            # AR/R, AP/R, AR/P or AP/P
            if len(d0) > 1:
                ddouble = d0
                dsingle = d1[0]
            else:
                dsingle = d0[0]
                ddouble = d1
            double_ops = [d.op for d in ddouble]
            if double_ops[1] != dsingle.op:
                # AR/P or AP/R
                # Onesided addition + conflicted patch/delete as above
                # TODO: Should we make addition conflicted as well?
                if dsingle == d1[0]:
                    # Addition is locally
                    decisions.onesided(path, d0[0:1], None)
                    decisions.conflict(path, d0[1:], d1)
                else:
                    # Addtion is remotely
                    decisions.onesided(path, None, d1[0:1])
                    decisions.conflict(path, d0, d1[1:])
            elif dsingle.op == DiffOp.REMOVERANGE:
                # AR/R
                # As chunking assures identical Rs, there is no conflict
                # here! Simply split into onesided A + agreement R
                if dsingle == d1[0]:
                    # Addition is locally
                    decisions.onesided(path, d0[0:1], None)
                    decisions.agreement(path, d0[1:], d1)
                else:
                    # Addtion is remotely
                    decisions.onesided(path, None, d1[0:1])
                    decisions.agreement(path, d0, d1[1:])
            else:
                # AP/P, by eliminiation
                assert dsingle.op == DiffOp.PATCH
                # Simply mark as conflict, and let auto resolve deal with this
                decisions.conflict(path, d0, d1)

        else:
            # A/AR, A/AP, AR/AP, AR/AR, AP/AP
            ops = [d.op for d in d0 + d1]
            if DiffOp.PATCH in ops:
                # A/AP, AR/AP or AP/AP:
                # In these cases, simply merge the As, then conflict remaining
                # op for autoresolve to deal with
                _merge_concurrent_inserts(
                    base, d0[:1], d1[:1], path, decisions)
                decisions.conflict(path, d0[1:], d1[1:])
            elif len(d0) < 2 or len(d1) < 2:
                # A/A or A/AR
                # This is in principle a range substitution!
                _merge_concurrent_inserts(base, d0, d1, path, decisions)
            else:
                # AR/AR
                decisions.conflict(path, d0, d1)


def _merge_strings(base, local_diff, remote_diff,
                   path, decisions):
    """Perform a three-way merge of strings. See docstring of merge."""
    assert isinstance(base, string_types)

    # This functions uses a (static) state variable to track recusrion.
    # The first time it is called, will be with base as a (potentially)
    # multi-line string. We then split this string on line endings, and merge
    # it as a list of lines (giving line-based chunking). However, there if
    # there are conflicting edits (patches) of a line, we will re-enter this
    # function, at which point we simply mark it as a conflict on the parent
    # level (conflicted lines)

    if _merge_strings.recursion:
        # base is a single line with differing edits. We could merge as list of
        # characters, but this is unreliable, and will conflict with line-based
        # chunking.

        # Mark as a conflict on parent (line):
        k = path[-1]
        decisions.conflict(path[:-1],
                           [op_patch(k, local_diff)],
                           [op_patch(k, remote_diff)])
        _merge_strings.recursion = False
    else:
        # Merge lines as lists
        _merge_strings.recursion = True
        base = base.splitlines(True)

        _merge_lists(
            base, local_diff, remote_diff, path, decisions)

_merge_strings.recursion = False


def _merge(base, local_diff, remote_diff, path, decisions):
    if isinstance(base, dict):
        return _merge_dicts(
            base, local_diff, remote_diff, path, decisions)
    elif isinstance(base, list):
        return _merge_lists(
            base, local_diff, remote_diff, path, decisions)
    elif isinstance(base, string_types):
        return _merge_strings(
            base, local_diff, remote_diff, path, decisions)
    else:
        raise ValueError("Cannot handle merge of type {}.".format(type(base)))


def decide_merge_with_diff(base, local, remote, local_diff, remote_diff):
    """Do a three-way merge of same-type collections b, l, r with given diffs
    b->l and b->r."""
    path = ()
    decisions = MergeDecisionBuilder()
    _merge(base, local_diff, remote_diff, path,
           decisions)
    return decisions.validated(base)


def decide_merge(base, local, remote):
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
    local_diff = diff(base, local)
    remote_diff = diff(base, remote)
    return decide_merge_with_diff(base, local, remote, local_diff, remote_diff)
