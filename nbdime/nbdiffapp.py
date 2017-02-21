# coding: utf-8

# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

import io
import os
import sys
import argparse
import nbformat
import json

import nbdime
from nbdime.diffing.notebooks import diff_notebooks
from nbdime.prettyprint import pretty_print_notebook_diff
from nbdime.args import add_generic_args, add_diff_args, add_filename_args
from nbdime.utils import EXPLICIT_MISSING_FILE, read_notebook, setup_std_streams


_description = "Compute the difference between two Jupyter notebooks."


def main_diff(args):
    afn = args.base
    bfn = args.remote
    dfn = args.output

    for fn in (afn, bfn):
        if not os.path.exists(fn) and fn != EXPLICIT_MISSING_FILE:
            print("Missing file {}".format(fn))
            return 1
    # Both files cannot be missing
    assert not (afn == EXPLICIT_MISSING_FILE and bfn == EXPLICIT_MISSING_FILE)

    a = read_notebook(afn, on_null='empty')
    b = read_notebook(bfn, on_null='empty')

    d = diff_notebooks(a, b)

    if dfn:
        with io.open(dfn, "w", encoding="utf8") as df:
            # Compact version:
            #json.dump(d, df)
            # Verbose version:
            json.dump(d, df, indent=2, separators=(",", ": "))
    else:
        # This printer is to keep the unit tests passing,
        # some tests capture output with capsys which doesn't
        # pick up on sys.stdout.write()
        class Printer:
            def write(self, text):
                print(text, end="")
        pretty_print_notebook_diff(afn, bfn, a, d, Printer())

    return 0


def _build_arg_parser():
    """Creates an argument parser for the nbdiff command."""
    parser = argparse.ArgumentParser(
        description=_description,
        add_help=True,
        )
    add_generic_args(parser)
    add_diff_args(parser)
    add_filename_args(parser, ["base", "remote"])

    parser.add_argument(
        '-o', '--output',
        default=None,
        help="if supplied, the diff is written to this file. "
             "Otherwise it is printed to the terminal.")

    return parser


def main(args=None):
    if args is None:
        args = sys.argv[1:]
    setup_std_streams()
    arguments = _build_arg_parser().parse_args(args)
    nbdime.log.init_logging(level=arguments.log_level)
    return main_diff(arguments)


if __name__ == "__main__":
    sys.exit(main())
