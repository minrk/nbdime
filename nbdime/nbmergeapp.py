# coding: utf-8

# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

import io
import os
import sys
import argparse

import nbformat

import nbdime
import nbdime.log
from nbdime.merging import merge_notebooks
from nbdime.prettyprint import pretty_print_merge_decisions
from nbdime.utils import EXPLICIT_MISSING_FILE, read_notebook, setup_std_streams

_description = ('Merge two Jupyter notebooks "local" and "remote" with a '
                'common ancestor "base".')


def main_merge(args):
    bfn = args.base
    lfn = args.local
    rfn = args.remote
    mfn = args.output

    for fn in (bfn, lfn, rfn):
        if not os.path.exists(fn) and fn != EXPLICIT_MISSING_FILE:
            nbdime.log.error("Cannot find file '{}'".format(fn))
            return 1

    if lfn == rfn == EXPLICIT_MISSING_FILE:
        # Deleted both locally and remotely
        # Special case not well solved by routines below
        handle_agreed_deletion(bfn, mfn, args.decisions)
        # Agreed on deletion = no conflics = return 0
        return 0

    b = read_notebook(bfn, on_null='minimal')
    l = read_notebook(lfn, on_null='minimal')
    r = read_notebook(rfn, on_null='minimal')

    merged, decisions = merge_notebooks(b, l, r, args)
    conflicted = [d for d in decisions if d.conflict]

    returncode = 1 if conflicted else 0

    if conflicted:
        nbdime.log.warning("Conflicts occured during merge operation.")
    else:
        nbdime.log.debug("Merge completed successfully with no unresolvable conflicts.")

    if args.decisions:
        # Print merge decisions (including unconflicted)
        out = io.StringIO()
        pretty_print_merge_decisions(b, decisions, out=out)
        nbdime.log.warning("Decisions:\n%s", out.getvalue())
    elif mfn:
        # Write partial or fully completed merge to given foo.ipynb filename
        with io.open(mfn, "w", encoding="utf8") as mf:
            nbformat.write(merged, mfn)
        nbdime.log.info("Merge result written to %s" % mfn)
    else:
        # Write merged notebook to terminal
        nbformat.write(merged, sys.stdout)
    return returncode


def handle_agreed_deletion(base_fn, output_fn, print_decisions=False):
    """Handle merge when file has been deleted both locally and remotely"""
    assert base_fn != EXPLICIT_MISSING_FILE
    b = read_notebook(base_fn, on_null='minimal')
    if print_decisions:
        # Print merge decision (delete all)
        from nbdime.diffing.notebooks import diff_notebooks
        from nbdime.merging.decisions import MergeDecisionBuilder
        # Build diff for deleting all content:
        diff = diff_notebooks(b, {})
        # Make agreed decision from diff:
        bld = MergeDecisionBuilder()
        bld.agreement([], local_diff=diff, remote_diff=diff)
        decisions = bld.validated(b)
        # Print decition
        out = io.StringIO()
        pretty_print_merge_decisions(b, decisions, out=out)
        nbdime.log.warning("Decisions:\n%s", out.getvalue())

    elif output_fn:
        # Delete file if existing, if not do nothing
        if os.path.exists(output_fn):
            os.remove(output_fn)
            nbdime.log.info("Output file deleted: %s" % output_fn)


def _build_arg_parser():
    """Creates an argument parser for the nbdiff command."""
    parser = argparse.ArgumentParser(
        description=_description,
        add_help=True,
        )
    from .args import add_generic_args, add_diff_args, add_merge_args, add_filename_args
    add_generic_args(parser)
    add_diff_args(parser)
    add_merge_args(parser)
    add_filename_args(parser, ["base", "local", "remote"])

    parser.add_argument(
        '-o', '--output',
        default=None,
        help="if supplied, the merged notebook is written "
             "to this file. Otherwise it is printed to the "
             "terminal.")
    parser.add_argument(
        '-d', '--decisions',
        action="store_true",
        help="print a human-readable summary of conflicted "
             "merge decisions instead of merging the notebook.")

    return parser


def main(args=None):
    if args is None:
        args = sys.argv[1:]
    setup_std_streams()
    nbdime.log.init_logging()
    arguments = _build_arg_parser().parse_args(args)
    nbdime.log.init_logging(level=arguments.log_level)
    return main_merge(arguments)


if __name__ == "__main__":
    sys.exit(main())
