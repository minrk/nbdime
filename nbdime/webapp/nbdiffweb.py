#!/usr/bin/env python
# -*- coding:utf-8 -*-

from __future__ import print_function

import sys
from argparse import ArgumentParser
import warnings

from .nbdimeserver import main_server as run_server
from .webutil import browse as browse_util
from ..args import (
    add_generic_args, add_web_args, add_diff_args, add_filename_args,
    args_for_server, args_for_browse)
import nbdime.log


def build_arg_parser():
    """
    Creates an argument parser for the diff tool, that also lets the
    user specify a port and displays a help message.
    """
    description = 'Difftool for Nbdime.'
    parser = ArgumentParser(
        description=description,
        add_help=True
        )
    add_generic_args(parser)
    add_web_args(parser, 0)
    add_diff_args(parser)
    add_filename_args(parser, ["base", "remote"])
    return parser


def browse(port, base, remote, browser):
    browse_util(port=port,
                browsername=browser,
                rel_url='diff',
                base=base,
                remote=remote)
    warnings.warn(
        'This function is deprecated. '
        'Use nbdime.webapp.webutil.browse() instead.',
        DeprecationWarning)


def main(args=None):
    if args is None:
        args = sys.argv[1:]
    arguments = build_arg_parser().parse_args(args)
    nbdime.log.init_logging(level=arguments.log_level)
    base = arguments.base
    remote = arguments.remote
    return run_server(
        closable=True,
        on_port=lambda port: browse_util(
            port=port,
            rel_url='diff',
            base=base, remote=remote,
            **args_for_browse(arguments)),
        **args_for_server(arguments))


if __name__ == "__main__":
    sys.exit(main())
