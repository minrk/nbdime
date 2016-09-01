# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import unicode_literals

from six import string_types
from six.moves import xrange as range
import itertools
import copy

from .log import NBDiffFormatError


class DiffEntry(dict):
    """For internal usage in nbdime library.

    Minimal class providing attribute access to diff entiry keys.

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


def offset_op(e, n):
    "Recreate sequence diff entry with offset added to key."
    e = DiffEntry(e)
    e.key += n
    return e


class DiffOp:
    "Collection of valid values for the action field in diff entries."
    ADD = "add"
    REMOVE = "remove"
    REPLACE = "replace"
    ADDRANGE = "addrange"
    REMOVERANGE = "removerange"
    PATCH = "patch"

    # For future consideration
    #KEEP = "keep"
    #KEEPRANGE = "keeprange"
    #MOVE = "move"
    #MOVERANGE = "moverange"


#def op_keep(key):
#    "Create a diff entry to keep value at key."
#    return DiffEntry(op=DiffOp.KEEP, key=key)

def op_add(key, value):
    "Create a diff entry to add value at/before key."
    return DiffEntry(op=DiffOp.ADD, key=key, value=value)

def op_remove(key):
    "Create a diff entry to remove value at key."
    return DiffEntry(op=DiffOp.REMOVE, key=key)

def op_replace(key, value):
    "Create a diff entry to replace value at key with given value."
    return DiffEntry(op=DiffOp.REPLACE, key=key, value=value)

#def op_keeprange(key, length):
#    "Create a diff entry to keep values in range key:key+length."
#    return DiffEntry(op=DiffOp.KEEPRANGE, key=key, length=length)

def op_addrange(key, valuelist):
    "Create a diff entry to add given list of values before key."
    return DiffEntry(op=DiffOp.ADDRANGE, key=key, valuelist=valuelist)

def op_removerange(key, length):
    "Create a diff entry to remove values in range key:key+length."
    return DiffEntry(op=DiffOp.REMOVERANGE, key=key, length=length)

def op_patch(key, diff):
    "Create a diff entry to patch value at key with diff."
    return DiffEntry(op=DiffOp.PATCH, key=key, diff=diff)


class SequenceDiffBuilder(object):

    # Valid values for the action field in sequence diff entries
    OPS = (
        DiffOp.ADDRANGE,
        DiffOp.REMOVERANGE,
        #DiffOp.KEEPRANGE,
        DiffOp.PATCH,
        )

    def __init__(self):
        self._diff = []

    def validated(self):
        return self._diff

    def append(self, entry):
        # Simplifies some algorithms
        if entry is None:
            return

        # Typechecking (just for internal consistency checking)
        assert isinstance(entry, DiffEntry)
        assert "op" in entry
        assert entry.op in SequenceDiffBuilder.OPS
        assert "key" in entry

        # Assert consistent ordering of diff entries
        _prev = self._diff[-1].key if self._diff else 0
        assert _prev <= entry.key

        # Add entry!
        self._diff.append(entry)

        # Swap last two entries if insertion was inserted
        # at same location as a previous remove or patch
        if (entry.op == DiffOp.ADDRANGE and
            len(self._diff) >= 2 and entry.key == self._diff[-2].key
            ):
            self._diff[-2], self._diff[-1] = self._diff[-1], self._diff[-2]

    def patch(self, key, diff):
        if diff:
            self.append(op_patch(key, diff))

    def addrange(self, key, valuelist):
        if valuelist:
            self.append(op_addrange(key, valuelist))

    def removerange(self, key, length):
        if length:
            self.append(op_removerange(key, length))

    #def keeprange(self, key, length):
    #    if length:
    #        self.append(op_keeprange(key, length))


class MappingDiffBuilder(object):

    # Valid values for the action field in mapping diff entries
    OPS = (
        #DiffOp.KEEP,
        DiffOp.ADD,
        DiffOp.REMOVE,
        DiffOp.REPLACE,
        DiffOp.PATCH,
        )

    def __init__(self):
        self._diff = {}

    def validated(self):
        return sorted(self._diff.values(), key=lambda x: x.key)

    def append(self, entry):
        # Simplifies some algorithms
        if entry is None:
            return

        # Typechecking (just for internal consistency checking)
        assert isinstance(entry, DiffEntry)
        assert "op" in entry
        assert entry.op in MappingDiffBuilder.OPS
        assert "key" in entry
        assert entry.key not in self._diff

        # Add entry!
        self._diff[entry.key] = entry

    #def keep(self, key):
    #    self.append(op_keep(key))

    def add(self, key, value):
        self.append(op_add(key, value))

    def remove(self, key):
        self.append(op_remove(key))

    def replace(self, key, value):
        self.append(op_replace(key, value))

    def patch(self, key, diff):
        if diff:
            self.append(op_patch(key, diff))


def is_valid_diff(diff, deep=False):
    try:
        validate_diff(diff, deep=deep)
        result = True
    except NBDiffFormatError:
        result = False
        raise
    return result


def validate_diff(diff, deep=False):
    if not isinstance(diff, list):
        raise NBDiffFormatError("DiffOp must be a list.")
    for e in diff:
        validate_diff_entry(e, deep=deep)


sequence_types = string_types + (list,)


def validate_diff_entry(e, deep=False):
    """Check that e is a well formed diff entry, as documented under docs/."""

    # Entry is always a list with 3 items, or 2 in the special case of single item deletion
    if not isinstance(e, DiffEntry):
        raise NBDiffFormatError("DiffOp entry '{}' is not a diff type.".format(e))

    # Check key (list or str uses int key, dict uses str key)
    op = e.op
    key = e.key
    if isinstance(key, int) and op in SequenceDiffBuilder.OPS:
        if op == DiffOp.ADDRANGE:
            if not isinstance(e.valuelist, sequence_types):
                raise NBDiffFormatError("addrange expects a sequence of values to insert, not '{}'.".format(e.valuelist))
        elif op == DiffOp.REMOVERANGE:
            if not isinstance(e.length, int):
                raise NBDiffFormatError("removerange expects a number of values to delete, not '{}'.".format(e.length))
        elif op == DiffOp.PATCH:
            # e.diff is itself a diff, check it recursively if the "deep" argument is true
            # (the "deep" argument is here to avoid recursion and potential O(>n) performance pitfalls)
            if deep:
                validate_diff(e.diff, deep=deep)
        else:
            raise NBDiffFormatError("Unknown diff op '{}'.".format(op))
    elif isinstance(key, string_types) and op in MappingDiffBuilder.OPS:
        if op == DiffOp.ADD:
            pass  # e.value is a single value to insert at key
        elif op == DiffOp.REMOVE:
            pass  # no argument
        elif op == DiffOp.REPLACE:
            # e.value is a single value to replace value at key with
            pass
        elif op == DiffOp.PATCH:
            # e.diff is itself a diff, check it recursively if the "deep" argument is true
            # (the "deep" argument is here to avoid recursion and potential O(>n) performance pitfalls)
            if deep:
                validate_diff(e.diff, deep=deep)
        else:
            raise NBDiffFormatError("Unknown diff op '{}'.".format(op))
    else:
        msg = "Invalid diff entry key '{}' of type '{}'. Expecting int for sequences or unicode/str for mappings."
        raise NBDiffFormatError(msg.format(key, type(key)))

    # Note that false positives are possible, for example
    # we're not checking the values in any way, as they
    # can in principle be arbitrary json objects


def count_consumed_symbols(e):
    "Count how many symbols are consumed from each sequence by a single sequence diff entry."
    op = e.op
    if op == DiffOp.ADDRANGE:
        return (0, len(e.valuelist))
    elif op == DiffOp.REMOVERANGE:
        return (e.length, 0)
    elif op == DiffOp.PATCH:
        return (1, 1)
    else:
        raise NBDiffFormatError("Invalid op '{}'".format(op))


def source_as_string(source):
    "Return source as a single string, joined as lines if it's a list."
    if isinstance(source, list):
        source = "\n".join(line.strip("\n") for line in source)
    assert isinstance(source, string_types)
    return source


if hasattr(itertools, "accumulate"):
    _accum = itertools.accumulate
else:
    def _accum(seq):
        total = 0
        for x in seq:
            total += x
            yield total


_addops = (DiffOp.ADD, DiffOp.ADDRANGE)


def _overlaps(existing, new):
    """Check whether existing diff op shares a key with the new diffop, and if
    they also have the same op type.
    """
    if not existing:
        return False
    existing = existing[-1]  # Only need to check last op!
    if existing.op == new.op:
        if existing.key == new.key:
            # Found a match, combine ops
            return True
        elif (existing.op == DiffOp.REMOVERANGE and
                existing.key + existing.length >= new.key):
            # Overlapping deletes
            # Above check is open ended to allow sanity check here:
            assert existing.key + existing.length == new.key
            return True
    elif (existing.op in _addops and
            new.op in _addops and
            existing.key == new.key):
        # Addrange and single add can both point to same key
        return True
    return False


def _combine_ops(existing, new):
    """Combines two ops into a new one that does the same
    """
    if new.op in _addops:
        if existing.op == DiffOp.ADD:
            # Convert to range for compatibility
            d = op_addrange(existing.key, [existing.value])
        else:
            d = copy.deepcopy(existing)
        if new.op == DiffOp.ADDRANGE:
            d.valuelist += new.valuelist
        else:
            if isinstance(d.valuelist, string_types):
                d.valuelist += new.value
            else:
                d.valuelist.append(new.value)
        return d
    elif new.op == DiffOp.REMOVERANGE:
        assert existing.op == DiffOp.REMOVERANGE
        return op_removerange(existing.key, existing.length + new.length)


def flatten_list_of_string_diff(a, diff):
    """Translates a diff of strings split by str.splitlines() to a diff of
    the joined multiline string.
    """
    if isinstance(a, string_types):
        a = a.splitlines(True)

    line_to_char = [0] + list(_accum(len(ia) for ia in a))
    flattened = []
    for e in diff:
        op = e.op
        line_offset = line_to_char[e.key]
        if op == DiffOp.PATCH:
            # For patches, each entry will have keys relative to line start
            # So we simply need to offset each key with line offset
            for p in e.diff:
                d = copy.deepcopy(p)
                d.key += line_offset
                # If it overlaps with an existing op, combine them to one
                if _overlaps(flattened, d):
                    flattened[-1] = _combine_ops(flattened[-1], d)
                else:
                    flattened.append(d)
        else:
            # Other ops simply have keys which refer to lines
            if op == DiffOp.ADDRANGE:
                d = op_addrange(line_offset, "".join(e.valuelist))
            elif op == DiffOp.REMOVERANGE:
                d = op_removerange(
                    line_offset, line_to_char[e.key + e.length] - line_offset)
            else:
                # Other ops simply need to adjust key as add/replace's value
                # will already be a string
                d = copy.deepcopy(e)
                d.key = line_offset

            # If it overlaps with an existing op, combine them to one
            if _overlaps(flattened, d):
                flattened[-1] = _combine_ops(flattened[-1], d)
            else:
                flattened.append(d)
    flattened.sort(key=lambda x: x.key)
    return flattened


def to_clean_dicts(di):
    "Recursively convert dict-like objects to straight python dicts."
    if isinstance(di, dict):
        return {k: to_clean_dicts(v) for k, v in di.items()}
    elif isinstance(di, list):
        return [to_clean_dicts(v) for v in di]
    else:
        return di


def to_diffentry_dicts(di):  # TODO: Better name, validate_diff? as_diff?
    "Recursively convert dict objects to DiffEntry objects with attribute access."
    if isinstance(di, dict):
        return DiffEntry(**{k: to_diffentry_dicts(v) for k, v in di.items()})
    elif isinstance(di, list):
        return [to_diffentry_dicts(v) for v in di]
    else:
        return di


def decompress_sequence_diff(di, n):
    """Convert sequence diff into pairs of (op, arg) for each n entries in base sequence.

    This is for internal use in algorithms where no
    insertions occur, making the mapping

        index -> (op, arg)

    possible with op in (KEEP, REMOVE, PATCH, REPLACE).
    """
    offset = 0
    decompressed = [op_keep(i) for i in range(n)]
    for e in di:
        op = e.op
        if op in (DiffOp.PATCH, DiffOp.REPLACE, DiffOp.REMOVE):
            decompressed[e.key] = e
        elif op == DiffOp.REMOVERANGE:
            for i in range(e.length):
                decompressed[e.key + i] = op_remove(e.key + i)
        elif op in (DiffOp.ADDRANGE, DiffOp.ADD):
            raise ValueError("Not expexting insertions.")
        else:
            raise ValueError("Unknown op {}.".format(op))
    return decompressed


def as_dict_based_diff(di):
    """Converting to dict-based diff format for dicts for convenience.

    NB! Only one level, not recursive.

    This step will be unnecessary if we change the diff format to work this way always.
    """
    return {e.key: e for e in di}


def revert_as_dict_based_diff(di):
    "Reverts as_dict_based_diff."
    return [di[k] for k in sorted(di)]


def to_json_patch(d, path=""):
    """Convert nbdime diff object into the RFC6902 JSON Patch format.

    This is untested and will need some details worked out.
    """
    print("Warning: to_json_patch is not thouroughly tested.")
    jp = []
    offset = 0
    for e in d:
        op = e.op
        if op == DiffOp.ADD:
            assert isinstance(e.key, string_types)
            p = "/".join([path, e.key])
            jp.append({"op": "add", "path": p, "value": e.value})
        elif op == DiffOp.REPLACE:
            assert isinstance(e.key, string_types)
            p = "/".join([path, e.key])
            jp.append({"op": "replace", "path": p, "value": e.value})
        elif op == DiffOp.REMOVE:
            assert isinstance(e.key, string_types)
            p = "/".join([path, e.key])
            jp.append({"op": "remove", "path": p})
        elif op == DiffOp.ADDRANGE:
            # JSONPatch only has single value add, no addrange,
            # repeat addition after increasing index instead
            assert isinstance(e.key, int)
            for value in e.valuelist:
                p = "/".join([path, str(e.key + offset)])
                jp.append({"op": "add", "path": p, "value": value})
                offset += 1
        elif op == DiffOp.REMOVERANGE:
            assert isinstance(e.key, int)
            # JSONPatch only has single value remove, no removerange,
            # repeat removal at same index instead
            p = "/".join((path, str(e.key + offset)))
            for i in range(e.length):
                jp.append({"op": "remove", "path": p})
                offset -= 1
        elif op == DiffOp.PATCH:
            # JSONPatch has no recursion, recurse here to flatten diff
            key = e.key
            if isinstance(key, int):
                key += offset
            p = "/".join([path, str(key)])
            jp.extend(to_json_patch(e.diff, p))
    return jp

