# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six import string_types, text_type
from six.moves import xrange as range

import copy
import nbformat

import nbdime.log
from ..diff_format import (
    DiffOp, op_removerange, op_remove, op_patch, op_replace)
from ..patching import patch
from ..utils import (
    r_is_int, star_path, join_path, is_prefix_array, find_shared_prefix)

def as_list(x):
    if x is None:
        return x
    if isinstance(x, tuple):
        return list(x)
    if not isinstance(x, list):
        return [x]
    return x

class MergeDecision(dict):
    """For internal usage in nbdime library.

    Minimal class providing attribute access to merge decision keys.

    Tip: If performance dictates, we can easily replace this
    with a namedtuple during processing of diffs and convert
    to dicts before any json conversions.
    """

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            return self.__getattribute__(name)
        return self[name]

    def __setattr__(self, name, value):
        self[name] = value

    def local_path(self):
        level = self.get('_level', 0)
        return (self.common_path or ())[level:]


class MergeDecisionBuilder(object):
    """A helper class for building a series of decisions to describe a merge.
    """
    def __init__(self):
        self.decisions = []

    def __bool__(self):
        return bool(self.decisions)

    def __nonzero__(self):
        return bool(self.decisions)

    def __len__(self):
        return len(self.decisions)

    def __iter__(self):
        return iter(self.decisions)

    def validated(self, base):
        """Returns decisions in state ready for application.

        Most importantly, this sorts the decisions on the path, so that it is
        in accordance with the specs.
        """
        # Remove fields 'strategy' used for internal decision making but not part of spec
        for d in self.decisions:
            if "strategy" in d:
                del d["strategy"]
        return sorted(self.decisions, key=_sort_key, reverse=True)

    def extend(self, decisions):
        if isinstance(decisions, MergeDecisionBuilder):
            decisions = decisions.decisions
        self.decisions.extend(decisions)

    def get_conflicted(self):
        return [d for d in self.decisions if d.conflict]

    def has_conflicted(self):
        return any(d.conflict for d in self.decisions)

    def add_decision(self, path, action, local_diff, remote_diff,
                     conflict=False, strategy=None, **kwargs):
        """Add a decision to the builder with the specified properties.

        Ensures data types and paths are as they should be, before creating a
        MergeDecision and adding it to its internal store.
        """
        # Ensure path is immutable
        if isinstance(path, list):
            path = tuple(path)
        else:
            assert isinstance(path, tuple)
        custom_diff = kwargs.pop("custom_diff", None)
        # Ensure diffs are lists or None
        local_diff = as_list(local_diff)
        remote_diff = as_list(remote_diff)
        custom_diff = as_list(custom_diff)
        # Ensure paths are pushed out as far in tree as possible
        path, (local_diff, remote_diff, custom_diff) = \
            ensure_common_path(path, [local_diff, remote_diff, custom_diff])
        if custom_diff is not None:
            kwargs["custom_diff"] = custom_diff
        # Store strategy field only if given
        if strategy is not None:
            kwargs["strategy"] = strategy

        # Finally store decision
        self.decisions.append(MergeDecision(
            common_path=path,
            conflict=conflict,
            action=action,
            local_diff=local_diff,
            remote_diff=remote_diff,
            **kwargs
            ))

    def base(self, path, local_diff, remote_diff, conflict=False, strategy=None):
        self.add_decision(
            path=path,
            action="base",
            conflict=conflict,
            local_diff=local_diff,
            remote_diff=remote_diff,
            strategy=strategy
            )

    def onesided(self, path, local_diff, remote_diff, conflict=False):
        assert local_diff or remote_diff
        assert not (local_diff and remote_diff)
        if local_diff:
            action = "local"
        elif remote_diff:
            action = "remote"
        self.add_decision(
            path=path,
            action=action,
            local_diff=local_diff,
            remote_diff=remote_diff
            )

    def local_then_remote(self, path, local_diff, remote_diff, conflict=False, strategy=None):
        assert local_diff and remote_diff
        assert local_diff != remote_diff
        action = "local_then_remote"
        self.add_decision(
            path=path,
            conflict=conflict,
            action=action,
            local_diff=local_diff,
            remote_diff=remote_diff,
            strategy=strategy
            )

    def remote_then_local(self, path, local_diff, remote_diff, conflict=False, strategy=None):
        assert local_diff and remote_diff
        assert local_diff != remote_diff
        action = "remote_then_local"
        self.add_decision(
            path=path,
            conflict=conflict,
            action=action,
            local_diff=local_diff,
            remote_diff=remote_diff,
            strategy=strategy
            )

    def agreement(self, path, local_diff, remote_diff, conflict=False):
        assert local_diff and remote_diff
        assert local_diff == remote_diff
        self.add_decision(
            path=path,
            action="either",
            local_diff=local_diff,
            remote_diff=remote_diff,
            )

    def tryresolve(self, path, local_diff, remote_diff, strategy):
        """Try to resolve conflict with given strategy.

        If successful, registers a decision and returns the action used.
        If failing, does not register a decision and returns None.

        Valid strategies here are:
            use-local, use-remote, use-base, clear, take-max
        """
        if not strategy:
            return None

        assert local_diff and remote_diff
        assert local_diff != remote_diff

        # Allow strategies to defuse situation first
        action = None
        if strategy:
            # Applying strategies here works well for leaf nodes at least
            if strategy == "use-local":
                action = "local"
            elif strategy == "use-remote":
                action = "remote"
            elif strategy == "use-base":
                action = "base"
            elif strategy == "clear":
                action = "clear"
            elif strategy == "take-max":
                action = "take_max"
            elif strategy == "fail":
                msg = "Unexpected conflict on {}.".format(path)
                nbdime.log.error(msg)
                raise RuntimeError(msg)
            else:
                msg = "Unhandled conflict strategy {} on {}".format(
                    strategy, join_path(path))
                nbdime.log.warning(msg)

        if action is not None:
            self.add_decision(
                path=path,
                conflict=False,
                action=action,
                local_diff=local_diff,
                remote_diff=remote_diff,
                strategy=strategy
                )
        return action

    def conflict(self, path, local_diff, remote_diff, strategy=None):
        """Register a potential conflict.

        If strategy is given, tries to resolve conflict first with tryresolve.

        Complex strategies not handled by tryresolve need to be handled at
        an earlier stage and will result in a regular conflict here.
        """
        assert local_diff and remote_diff
        assert local_diff != remote_diff

        # Try to defuse situation with given strategy
        action = self.tryresolve(path, local_diff, remote_diff, strategy)

        # If none of them applied, use base and mark as conflict
        if action is None:
            # If a strategy was provided but failed to apply, mark as conflict.
            # NB! Not passing strategy argument on to decision because it hasn't been applied.
            self.add_decision(
                path=path,
                conflict=True,
                action="base",
                local_diff=local_diff,
                remote_diff=remote_diff
                )

    def local(self, path, local_diff, remote_diff, conflict=False, strategy=None):
        assert local_diff
        action = "local"
        self.add_decision(
            path=path,
            action=action,
            conflict=conflict,
            local_diff=local_diff,
            remote_diff=remote_diff,
            strategy=strategy
            )

    def remote(self, path, local_diff, remote_diff, conflict=False, strategy=None):
        assert remote_diff
        action = "remote"
        self.add_decision(
            path=path,
            action=action,
            conflict=conflict,
            local_diff=local_diff,
            remote_diff=remote_diff,
            strategy=strategy
            )

    def custom(self, path, local_diff, remote_diff, custom_diff, conflict=False, strategy=None):
        action = "custom"
        self.add_decision(
            path=path,
            conflict=conflict,
            action=action,
            local_diff=local_diff,
            remote_diff=remote_diff,
            custom_diff=custom_diff,
            strategy=strategy
            )


def ensure_common_path(path, diffs):
    """Resolves common paths in a list of diffs.

    If a local and a remote diff both patch a key "a", this will return the
    common path ("a",), and the inner diffs of the patch operations. Works
    recursively, so a common chain of patches will be resolved as well.
    """
    assert isinstance(path, (tuple, list))
    popped = _pop_path(diffs)
    while popped:
        path = path + (popped["key"],)
        diffs = popped["diffs"]
        popped = _pop_path(diffs)
    return path, diffs


def _pop_path(diffs):
    """Pops of a common path from patch ops sharing a common key.

    Checks whether all diffs are single patch operations sharing the same key,
    or alternatively empty diffs. If so, it returns the shared path/key as well
    as the inner diffs of the patch operations (in the same order as the passed
    diffs).
    """
    key = None
    popped_diffs = []
    for d in diffs:
        # Empty diffs can be skipped
        if d is None or len(d) == 0:
            popped_diffs.append(None)
            continue
        # Check that we have only one op, which is a patch op
        if len(d) != 1 or d[0].op != DiffOp.PATCH:
            return
        # Ensure all present diffs have the same key
        if key is None:
            key = d[0].key
        elif key != d[0].key:
            return
        # Ensure the sub diffs of all ops are suitable as outer layer
        # if len(d[0].diff) > 1:
        #    return
        popped_diffs.append(d[0].diff)
    if key is None:
        return
    return {'key': key, 'diffs': popped_diffs}


def push_path(path, diffs):
    """Wraps the diffs in patch operations matching path.
    """
    for key in reversed(path):
        diffs = [op_patch(key, diffs)]
    return diffs


def pop_patch_decision(decision):
    """Create a new decision one level lower in diff tree.

    Checks whether all diffs are single patch operations sharing the same key,
    or alternatively empty diffs. A new decision is then created at that key.

    Returns the new decision.

    Returns None if a decision can not be created at the lower level.
    """
    diffs = [decision.local_diff, decision.remote_diff]
    if decision.action == "custom":
        diffs.append(decision.custom_diff)
    popped = _pop_path(diffs)
    if popped is None:
        return None
    ret = MergeDecision(
        common_path=decision.common_path + (popped["key"],),
        local_diff=popped["diffs"][0],
        remote_diff=popped["diffs"][1],
        action=decision.action,
        conflict=decision.conflict)
    if decision.action == "custom":
        ret.custom_diff = popped["diffs"][2]
    return ret


def pop_all_patch_decisions(decision):
    """Create a new decision at the furthest level in the diff tree.

    Calls `pop_patch_decision` recursively until it is at the lowest possible
    decision level.

    If the decision is already at the lowest level, it returns the original
    decision.
    """
    popped = pop_patch_decision(decision)
    while popped is not None:
        decision = popped
        popped = pop_patch_decision(decision)
    return decision


def push_patch_decision(decision, prefix):
    """Move a path prefix in a merge decision from `common_path` to the diffs.

    This is done by wrapping the diffs in nested patch ops.
    """
    dec = copy.copy(decision)
    # We need to start with inner most key to nest correctly, so reverse:
    for key in reversed(prefix):
        if len(dec.common_path) == 0:
            raise ValueError(
                "Cannot remove key from empty decision path: %s, %s" %
                (key, dec))
        assert dec.common_path[-1] == key, "Key %s not at end of %s" % (
            key, dec.common_path)
        dec.common_path = dec.common_path[:-1]  # pop key
        dec.local_diff = [op_patch(key, dec.local_diff)] if dec.local_diff else []
        dec.remote_diff = [op_patch(key, dec.remote_diff)] if dec.remote_diff else []
        if dec.action == "custom":
            dec.custom_diff = [op_patch(key, dec.custom_diff)] if dec.custom_diff else []
    return dec


def _sort_key(k):
    """Sort key for common paths. Ensures the correct order for processing,
    without having to care about offsetting indices.

    Heavily inspired by the natsort package:

    Copyright (c) 2012-2016 Seth M. Morton

    Permission is hereby granted, free of charge, to any person obtaining a copy of
    this software and associated documentation files (the "Software"), to deal in
    the Software without restriction, including without limitation the rights to
    use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
    of the Software, and to permit persons to whom the Software is furnished to do
    so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    """
    ret = []
    for s in k.common_path:
        if not isinstance(s, (int, text_type)):
            s = s.decode("utf8")
        if isinstance(s, text_type) and r_is_int.match(s):
            s = int(s)
        if isinstance(s, int):
            ret.append(('', -s))
        else:
            ret.append((s,))
    return ret


def split_string_path(base, path):
    """Prevent paths from pointing to specific string lines.

    Since strings are diffed as a sequence of lines without actually splitting
    the string in base, any path to a specific line will fail to resolve.
    This checks if path points to a specific line in a string, and splits off
    the final key of the path (the line number).

    Returns a tuple with the path without any line reference in the first
    position, and any line key in the second position.
    """
    for i in range(len(path)):
        if isinstance(base, string_types):
            return path[:i], path[i:]
        base = base[path[i]]
    return path, ()


def make_cleared_value(value):
    "Make a new 'cleared' value of the right type."
    if isinstance(value, list):
        # Clearing e.g. an outputs list means setting it to an empty list
        return []
    elif isinstance(value, dict):
        # Clearing e.g. a metadata dict means setting it to an empty dict
        return {}
    elif isinstance(value, string_types):
        # Clearing e.g. a source string means setting it to an empty string
        return ""
    else:
        # Clearing anything else (atomic values) means setting it to None
        return None


def filter_decisions(pattern, decisions, exact=False):
    ret = []
    cutoff = len(pattern)
    for i, md in enumerate(decisions):
        path = md.common_path[:]
        pop = _pop_path((md.local_diff, md.remote_diff, md.get('custom_diff')))
        if pop:
            path = path + (pop["key"],)
        starred_path = star_path(path)
        if (exact and starred_path == pattern or
                starred_path[:cutoff] == pattern):
            ret.append(i)
    return ret


# =============================================================================
#
# Code for applying decisions:
#
# =============================================================================

# # Strategies for handling conflicts
# generic_conflict_strategies = (
#     # on /cells/*/source, string in a dict, let decision be placed on the cell dict!
#     "inline-source",    # Valid for source only: produce new source with inline diff markers
#     # on /cells/*/outputs, list in a dict, let decision be placed on the cell dict!
#     "clear-all",        # Discard all values on conflict
#     # on /cells/*/outputs, list in a dict, let decision be placed on the cell dict!
#     "inline-outputs",   # Valid for outputs only: produce new outputs with inline diff markers
#     # on /.../metadata, add to a dict, let decision be placed on the cell dict!
#     "record-conflict",  # Valid for metadata only: produce new metadata with conflicts recorded for external inspection
#     )

def resolve_action(base, decision):
    a = decision.action

    if a == "base":
        return []   # no-op

    elif a in ("local", "either"):
        return copy.copy(decision.local_diff)

    elif a == "remote":
        return copy.copy(decision.remote_diff)

    elif a == "custom":
        return copy.copy(decision.custom_diff)

    elif a == "local_then_remote":
        return decision.local_diff + decision.remote_diff

    elif a == "remote_then_local":
        return decision.remote_diff + decision.local_diff

    elif a in ("clear", "remove"):
        key, = set(d.key for d in decision.local_diff + decision.remote_diff)
        if a == 'clear':
            return [op_replace(key, make_cleared_value(base[key]))]
        elif isinstance(base, (list,) + string_types):
            return [op_removerange(key, 1)]
        else:
            return [op_remove(key)]

    elif a == "clear_all":
        if isinstance(base, dict):
            # Ideally we would do a op_replace on the parent, but this is not
            # easily combined with this method, so simply remove all keys
            return [op_remove(key) for key in base.keys()]
        elif isinstance(base, (list,) + string_types):
            return [op_removerange(0, len(base))]

    elif a == "take_max":
        key, = set(d.key for d in decision.local_diff + decision.remote_diff)
        #assert len(decision.local_diff) == 1 == len(decision.remote_diff)
        bval = base[key]
        lval = decision.local_diff[0].value if decision.local_diff else bval
        rval = decision.remote_diff[0].value if decision.remote_diff else bval
        mval = max(bval, lval, rval)
        if bval == mval:
            return []
        else:
            return [op_replace(key, mval)]

    else:
        raise NotImplementedError("The action \"%s\" is not defined" % a)


def apply_decisions(base, decisions):
    """Apply a list of merge decisions to base.
    """
    from .generic import combine_patches
    
    merged = copy.deepcopy(base)
    prev_path = None
    parent = None
    last_key = None
    resolved = None
    diffs = []
    # clear_all actions should override other decisions on same obj, so
    # we need to track it
    clear_all_flag = False
    for md in decisions:
        path, line = split_string_path(merged, md.common_path)
        # We patch all decisions with the same path in one op
        if path == prev_path:
            # Same path as previous, collect entry
            if clear_all_flag:
                # Another entry will clear the parent, all other decisions
                # should be dropped
                pass
            else:
                if md.action == "clear_all":
                    clear_all_flag = True
                    # Clear any exisiting decisions!
                    diffs = []
                ad = resolve_action(resolved, md)
                if line:
                    ad = push_path(line, ad)
                diffs = combine_patches(diffs + ad)

        else:
            # Different path, start a new collection
            if prev_path is not None:
                # First, apply previous diffs
                if parent is None:
                    # Operations on root create new merged object
                    merged = patch(resolved, diffs)
                else:
                    # If not, overwrite entry in parent (which is an entry in
                    # merged). This is ok, as no paths should point to
                    # subobjects of the patched object
                    parent[last_key] = patch(resolved, diffs)

            prev_path = path
            # Resolve path in base and output
            resolved = merged
            parent = None
            last_key = None
            for key in path:
                parent = resolved
                resolved = resolved[key]   # Should raise if key missing
                last_key = key
            diffs = resolve_action(resolved, md)
            if line:
                diffs = push_path(line, diffs)
            clear_all_flag = md.action == "clear_all"
    # Apply the last collection of diffs, if present (same as above)
    if prev_path is not None:
        if parent is None:
            merged = patch(resolved, diffs)
        else:
            parent[last_key] = patch(resolved, diffs)

    merged = nbformat.from_dict(merged)
    return merged


def _merge_tree(tree, sorted_paths):
    """
    Merge a tree of diffs at varying path levels to one diff at their shared root

    Relies on the format specification about decision ordering to help
    simplify the process (deeper paths should come before its parent paths).
    This is realized by the `sorted_paths` argument.
    """
    trunk = []
    root = None
    for i in range(len(sorted_paths)):
        path = tree[sorted_paths[i]]['path']
        subdiffs = tree[sorted_paths[i]]['diff']
        trunk = trunk + subdiffs

        if i == len(sorted_paths) - 1:
            nextPath = root
        else:
            nextPath = tree[sorted_paths[i + 1]]['path']

        # First, check if path is subpath of nextPath:
        if is_prefix_array(nextPath, path):
            # We can simply promote existing diffs to next path
            if nextPath is not None:
                trunk = push_path(path[len(nextPath):], trunk)
                root = nextPath
        else:
            # We have started on a new trunk
            # Collect branches on the new trunk, and merge the trunks
            newTrunk = _merge_tree(tree, sorted_paths[i + 1:])
            nextPath = tree[sorted_paths[len(sorted_paths) - 1]]['path']
            prefix = find_shared_prefix(path, nextPath)
            pl = len(prefix) if prefix is not None else 0
            trunk = push_path(path[pl:], trunk) + push_path(nextPath[pl:], newTrunk)
            break   # Recursion will exhaust sorted_paths
    return trunk


def build_diffs(base, decisions, which):
    """
    Builds a diff for direct application on base. The `which` argument either
    selects the 'local', 'remote' or 'merged' diffs.
    """
    tree = {}
    sorted_paths = []
    assert which in ('local', 'remote', 'merged')
    local = which == 'local'
    merged = which == 'merged'

    for md in decisions:
        path, line = split_string_path(base, md.local_path())
        if merged:
            subdiffs = resolve_action(base[path], md)
        else:
            if local:
                subdiffs = md.local_diff
            else:
                subdiffs = md.remote_diff
            if subdiffs is None:
                continue

        str_path = join_path(path)
        if str_path in tree:
            # Existing tree entry, simply add diffs to it
            if line:
                match_diff = [d for d in tree[str_path]['diff'] if d.key == line[0]]
                if match_diff:
                    assert len(match_diff) == 1
                    assert match_diff[0].diff
                    match_diff[0].diff.extend(subdiffs)
                else:
                    subdiffs = push_path(line, subdiffs)
                    assert len(subdiffs) == 1
                    tree[str_path]['diff'].extend(subdiffs)
            else:
                tree[str_path]['diff'].extend(subdiffs)
        else:
            # Make new entry in tree
            if line:
                subdiffs = push_path(line, subdiffs)
            tree[str_path] = {'diff': subdiffs, 'path': path}
            sorted_paths.append(str_path)

    if len(tree) == 0:
        return None

    if '/' not in tree:
        tree['/'] = {'diff': [], 'path': []}
        sorted_paths.append('/')

    # Tree is constructed, now join all branches at diverging points (joints)
    return _merge_tree(tree, sorted_paths)
