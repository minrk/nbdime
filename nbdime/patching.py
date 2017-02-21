# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from six import string_types
import copy
import nbformat
from nbformat import NotebookNode

from .diff_format import DiffOp, NBDiffFormatError, flatten_list_of_string_diff



__all__ = ["patch", "patch_notebook"]


def patch_list(obj, diff):
    # The patched sequence to build and return
    newobj = []
    # Index into obj, the next item to take unless diff says otherwise
    take = 0
    for e in diff:
        op = e.op
        index = e.key
        assert isinstance(index, int)

        # Take values from obj not mentioned in diff, up to not including index
        newobj.extend(copy.deepcopy(value) for value in obj[take:index])

        if op == DiffOp.ADDRANGE:
            # Extend with new values directly
            newobj.extend(e.valuelist)
            skip = 0
        elif op == DiffOp.REMOVERANGE:
            # Delete a number of values by skipping
            skip = e.length
        elif op == DiffOp.PATCH:
            newobj.append(patch(obj[index], e.diff))
            skip = 1
        # Note that the operations ADD, REMOVE, REPLACE are not produced by the
        # diff algorithm anymore, keeping these cases just in case we want them back:
        elif op == DiffOp.ADD:
            # Append new value directly
            newobj.append(e.value)
            skip = 0
        elif op == DiffOp.REMOVE:
            # Delete values obj[index] by incrementing take to skip
            skip = 1
        elif op == DiffOp.REPLACE:
            # Add replacement value and skip old
            newobj.append(e.value)
            skip = 1
        else:
            raise NBDiffFormatError("Invalid op {}.".format(op))

        # Skip the specified number of elements, but never decrement take.
        # Note that take can pass index in diffs with repeated +/- on the
        # same index, i.e. [op_remove(index), op_add(index, value)]
        take = max(take, index + skip)

    # Take values at end not mentioned in diff
    newobj.extend(copy.deepcopy(value) for value in obj[take:len(obj)])

    return newobj


def patch_string(obj, diff):
    "Patch a multiline string, assuming diff is line based."
    # This can possibly be optimized for str if wanted, but
    # waiting until patch_list has been tested and debugged better

    # Flatten line-based diff to character based first!
    diff = flatten_list_of_string_diff(obj, diff)
    return "".join(patch_list(list(obj), diff))


def patch_singleline_string(obj, diff):
    "Patch a singleline string, assuming diff is character based."
    # This can possibly be optimized for str if wanted, but
    # waiting until patch_list has been tested and debugged better
    return "".join(patch_list(list(obj), diff))


def patch_dict(obj, diff):
    newobj = {}
    deleted_keys = set()

    for e in diff:
        op = e.op
        key = e.key
        assert isinstance(key, string_types)
        assert key not in newobj

        if op == DiffOp.ADD:
            assert key not in obj
            newobj[key] = e.value
        elif op == DiffOp.REMOVE:
            deleted_keys.add(key)
        elif op == DiffOp.REPLACE:
            assert key not in deleted_keys
            newobj[key] = e.value
        elif op == DiffOp.PATCH:
            assert key not in deleted_keys
            newobj[key] = patch(obj[key], e.diff)
        else:
            raise NBDiffFormatError("Invalid op {}.".format(op))

    # Take items not mentioned in diff
    for key in obj:
        if key not in deleted_keys and key not in newobj:
            newobj[key] = copy.deepcopy(obj[key])

    return NotebookNode(newobj)


def patch(obj, diff):
    """Produce a patched version of obj with given hierarchical diff.

    A valid input object can be any dict or list of leaf values,
    or arbitrarily nested dict or list of valid input objects.

    Dicts are required to have string keys.

    Leaf values are any non-dict, non-list objects as far as patch
    is concerned, although the intentional use of this library
    is that values are json-serializable.
    """
    if isinstance(obj, dict):
        return patch_dict(obj, diff)
    elif isinstance(obj, list):
        return patch_list(obj, diff)
    elif isinstance(obj, string_types):
        return patch_string(obj, diff)
    else:
        raise ValueError("Invalid object type to patch: {}".format(type(obj).__name__))


def patch_notebook(nb, diff):
    return nbformat.from_dict(patch(nb, diff))
