# coding: utf-8

# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import unicode_literals
from __future__ import print_function

import os
import sys
import argparse
from pprint import pprint

import nbformat
from ._version import __version__
from .merging import merge_notebooks

_description = ('Merge two Jupyter notebooks "local" and "remote" with a '
                'common ancestor "base".')


def main_merge(args):
    bfn = args.base
    lfn = args.local
    rfn = args.remote
    mfn = args.output

    for fn in (bfn, lfn, rfn):
        if not os.path.exists(fn):
            print("Cannot find file '{}'".format(fn))
            return 1

    b = nbformat.read(bfn, as_version=4)
    l = nbformat.read(lfn, as_version=4)
    r = nbformat.read(rfn, as_version=4)

    m, decisions = merge_notebooks(b, l, r, args)
    conflicted = [d for d in decisions if d.conflict]

    returncode = 1 if conflicted else 0

    if conflicted:
        print("Conflicts occured during merge operation.")
    else:
        print("Merge completed successfully with no unresolvable conflicts.")

    if mfn:
        # Add remaining conflicts to metadata
        if conflicted:
            m["metadata"]["nbdime-conflicts"] = conflicted
        # Write partial or fully completed merge to given foo.ipynb filename
        with open(mfn, "wb") as mf:
            # FIXME: We currently write this way as git needs \n line endings,
            # when used as merge driver. However, we should write using OS
            # line endings otherwise.
            nb = nbformat.from_dict(m)
            s = nbformat.writes(nb) + u'\n'
            mf.write(s.encode())
    else:
        # FIXME: Display conflicts in a useful way
        if conflicted:
            print("Conflicts:")
            pprint(conflicted)
        print("Merge result:")
        pprint(m)
    return returncode


def _build_arg_parser():
    """Creates an argument parser for the nbdiff command."""
    parser = argparse.ArgumentParser(
        description=_description,
        add_help=True,
        )
    from .nbdiffapp import add_generic_args, add_diff_args  # , add_webgui_args
    add_generic_args(parser)
    # add_webgui_args(parser)
    add_diff_args(parser)

    # TODO: Define sensible strategy variables and implement
    from .merging.notebooks import generic_conflict_strategies
    parser.add_argument(
        '-s', '--strategy',
        default="mergetool",
        choices=generic_conflict_strategies,
        help="Specify the merge strategy to use.")
    # parser.add_argument('-m', '--merge-strategy',
    #                     default="default", choices=("foo", "bar"),
    #                     help="Specify the merge strategy to use.")
    parser.add_argument(
        '-i', '--ignore-transients',
        action="store_true",
        default=False,
        help="Allow automatic deletion of transient data to resolve conflicts "
             "(output, execution count).")

    parser.add_argument('base',
                        help="The base notebook filename.")
    parser.add_argument('local',
                        help="The local modified notebook filename.")
    parser.add_argument('remote',
                        help="The remote modified notebook filename.")
    return parser


def main():
    args = _build_arg_parser().parse_args()
    r = main_merge(args)
    sys.exit(r)
