# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

from six import string_types

from contextlib import contextmanager
import shlex
import sys
from subprocess import check_output, check_call, STDOUT

import pytest
import nbformat

from nbdime import patch, diff
from nbdime.diff_format import is_valid_diff


try:
    from shutil import which
except ImportError:
    from backports.shutil_which import which

have_git = which('git')


def assert_is_valid_notebook(nb):
    """These are the current assumptions on notebooks in these tests. Loosen on demand."""
    assert nb["nbformat"] == 4
    # assert nb["nbformat_minor"] == 0
    assert isinstance(nb["metadata"], dict)
    assert isinstance(nb["cells"], list)
    assert all(isinstance(cell, dict) for cell in nb["cells"])


def check_diff_and_patch(a, b):
    "Check that patch(a, diff(a,b)) reproduces b."
    d = diff(a, b)
    assert is_valid_diff(d)
    assert patch(a, d) == b


def check_symmetric_diff_and_patch(a, b):
    "Check that patch(a, diff(a,b)) reproduces b and vice versa."
    check_diff_and_patch(a, b)
    check_diff_and_patch(b, a)


def sources_to_notebook(sources):
    assert isinstance(sources, list)
    assert len(sources) == 0 or isinstance(sources[0], list)
    nb = nbformat.v4.new_notebook()
    for source in sources:
        if isinstance(source, list):
            source = "".join(source)
        nb.cells.append(nbformat.v4.new_code_cell(source))
    return nb


def notebook_to_sources(nb, as_str=True):
    sources = []
    for cell in nb["cells"]:
        source = cell["source"]
        if as_str and isinstance(source, list):
            source = "\n".join([line.strip("\n") for line in source])
        elif not as_str and isinstance(source, string_types):
            source = source.splitlines(True)
        sources.append(source)
    return sources


def outputs_to_notebook(outputs):
    assert isinstance(outputs, list)
    assert len(outputs) == 0 or isinstance(outputs[0], list)
    nb = nbformat.v4.new_notebook()
    for cell_outputs in outputs:
        cell = nbformat.v4.new_code_cell()
        nb.cells.append(cell)
        for output in cell_outputs:
            if isinstance(output, string_types):
                output = nbformat.v4.new_output(
                    output_type="display_data",
                    data={
                        "text/plain": output,
                    }
                )
            assert isinstance(output, dict)
            cell.outputs.append(output)
    return nb


@contextmanager
def assert_clean_exit():
    """Assert that SystemExit is called with code=0"""
    with pytest.raises(SystemExit) as e:
        yield
    assert e.value.code == 0


def call(cmd):
    """Call a command

    if str, split into command list
    """
    if isinstance(cmd, string_types):
        cmd = shlex.split(cmd)
    return check_call(cmd, stdout=sys.stdout, stderr=sys.stderr)


def get_output(cmd, err=False):
    """Run a command and get its output (as text)"""
    if isinstance(cmd, string_types):
        cmd = shlex.split(cmd)
    stderr = STDOUT if err else sys.stderr
    return check_output(cmd, stderr=stderr).decode('utf8', 'replace')
