# coding: utf-8

# Copyright (c) IPython Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

import os
import sys
import argparse
import json
import nbformat
import io

import nbdime
from nbdime.patching import patch_notebook
from nbdime.diff_format import to_diffentry_dicts
from nbdime.utils import EXPLICIT_MISSING_FILE, read_notebook, setup_std_streams
from nbdime.prettyprint import pretty_print_notebook


_description = "Apply patch from nbdiff to a Jupyter notebook."


def main_patch(args):
    base_filename = args.base
    patch_filename = args.patch
    output_filename = args.output

    for fn in (base_filename, patch_filename):
        if not os.path.exists(fn) and fn != EXPLICIT_MISSING_FILE:
            print("Missing file {}".format(fn))
            return 1

    before = read_notebook(base_filename, on_null='empty')
    with io.open(patch_filename, encoding="utf8") as patch_file:
        diff = json.load(patch_file)
    diff = to_diffentry_dicts(diff)

    after = patch_notebook(before, diff)

    if output_filename:
        nbformat.write(after, output_filename)
    else:
        try:
            nbformat.validate(after, version=4)
        except nbformat.ValidationError:
            print("Patch result is not a valid notebook, printing as JSON:")
            json.dump(after, sys.stdout)
        else:
            pretty_print_notebook(after)

    return 0


def _build_arg_parser():
    """Creates an argument parser for the nbpatch command."""
    parser = argparse.ArgumentParser(
        description=_description,
        add_help=True,
        )
    from .args import add_generic_args, add_filename_args
    add_generic_args(parser)
    add_filename_args(parser, ["base", "patch"])
    parser.add_argument(
        '-o', '--output',
        default=None,
        help="if supplied, the patched notebook is written "
             "to this file. Otherwise it is printed to the "
             "terminal.")
    return parser


def main(args=None):
    if args is None:
        args = sys.argv[1:]
    setup_std_streams()
    arguments = _build_arg_parser().parse_args(args)
    nbdime.log.init_logging(level=arguments.log_level)
    return main_patch(arguments)


if __name__ == "__main__":
    sys.exit(main())
