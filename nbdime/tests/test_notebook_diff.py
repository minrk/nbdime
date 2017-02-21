# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""This file contains tests applying to reference notebook files from the nbdime/tests/files/ directory."""

from __future__ import print_function

import nbformat

from nbdime import patch, patch_notebook, diff_notebooks
from nbdime.diffing.notebooks import diff_cells

# pytest conf.py stuff is tricky to use robustly, this works with no magic
from .utils import assert_is_valid_notebook, check_diff_and_patch


def test_notebook_database_fixture(db):
    "Just test that the notebook file reader fixture is at least self-consistent."
    assert len(db) > 0
    assert len(list(db.keys())) == len(db)
    for name in db:
        assert name in db
        assert name + "notindb" not in db
        assert_is_valid_notebook(db[name])


def test_diff_and_patch_metadata_of_notebooks(any_nb_pair):
    "Test diff/patch on the metadata of any pair of notebooks in the test suite."
    nba, nbb = any_nb_pair
    a = nba["metadata"]
    b = nbb["metadata"]
    check_diff_and_patch(a, b)


def test_diff_and_patch_notebooks_with_generic_diff(any_nb_pair):
    "Test generic diff/patch on any pair of notebooks in the test suite."
    a, b = any_nb_pair
    check_diff_and_patch(a, b)


def test_diff_and_patch_cells_of_notebooks(any_nb_pair):
    "Test diff/patch on the cells of any pair of notebooks in the test suite."
    nba, nbb = any_nb_pair
    a = nba["cells"]
    b = nbb["cells"]
    assert patch(a, diff_cells(a, b)) == b


def test_diff_and_patch_matching_notebooks(matching_nb_pairs):
    "Test diff/patch on pairs of notebooks with the same basename in the test suite."
    a, b = matching_nb_pairs
    assert patch_notebook(a, diff_notebooks(a, b)) == nbformat.from_dict(b)


def test_diff_and_patch_notebooks(any_nb_pair):
    "Test diff/patch on any pair of notebooks in the test suite."
    a, b = any_nb_pair
    assert patch_notebook(a, diff_notebooks(a, b)) == nbformat.from_dict(b)
