# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from ._version import __version__

from .diffing import diff, diff_notebooks
from .patching import patch, patch_notebook
from .merging import merge_notebooks, decide_merge, apply_decisions

__all__ = [
    "__version__",
    "diff", "diff_notebooks",
    "patch", "patch_notebook",
    "decide_merge", "merge_notebooks", "apply_decisions"
    ]
