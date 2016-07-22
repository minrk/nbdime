#!/usr/bin/env python
"""A git mergetool plugin for notebooks.

Uses nbdime to merge notebooks instead of plain text merges of JSON.

Enable in your global git config with:

    git-nbmergetool config --enable [--global]

Use with:

    git mergetool [<commit> [<commit>]]
"""
import os
import sys
from subprocess import check_call, check_output, CalledProcessError

from . import nbmergeapp

def enable(global_=False):
    """Enable nbdime git mergetool"""
    cmd = ['git', 'config']
    if global_:
        cmd.append('--global')

    # Register CLI tool
    check_call(cmd + ['mergetool.nbdime.cmd', 'git-nbmergetool merge "$LOCAL" "$REMOTE" "$BASE" "$MERGED"'])
    try:
        previous = check_output(cmd + ['merge.tool']).decode('utf8', 'replace').strip()
    except CalledProcessError:
        previous = None
    else:
        if previous != 'nbdime':
            check_call(cmd + ['mergetool.nbdime.previous', previous])

    # Register webapp tool
    check_call(cmd + ['mergetool.nbdimeweb.cmd', 'git-nbwebmergetool "$LOCAL" "$REMOTE" "$BASE" "$MERGED"'])

    # Common setting:
    check_call(cmd + ['mergetool.prompt', 'false'])

    # Set default tool to webapp
    check_call(cmd + ['merge.tool', 'nbdimeweb'])


def disable(global_=False):
    """Disable nbdime git mergetool"""
    cmd = ['git', 'config']
    if global_:
        cmd.append('--global')
    try:
        previous = check_output(cmd + ['mergetool.nbdime.previous']).decode('utf8', 'replace').strip()
    except CalledProcessError:
        try:
            check_call(cmd + ['--unset', 'merge.tool'])
        except CalledProcessError:
            # already unset
            pass
    else:
        check_call(cmd + ['merge.tool', previous])


def show_merge(base, local, remote, merged):
    """Run the mergetool

    If we are merging a notebook, show the merge via nbmerge.
    Otherwise, exit with error code.
    """
    # TODO: handle /dev/null (Windows equivalent?) for new or deleted files
    if any([not f.endswith('.ipynb') for f in [base, local, remote, merged]]):
        return nbmergeapp.main([base, local, remote, merged])
    else:
        sys.exit(1)


def main():
    import argparse
    parser = argparse.ArgumentParser('git-nbmergetool', description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest='subcommand')

    merge_parser = subparsers.add_parser('merge',
        description="The actual entrypoint for the mergetool. Git will call this."
    )
    merge_parser.add_argument('base')
    merge_parser.add_argument('local')
    merge_parser.add_argument('remote')
    merge_parser.add_argument('merged')

    config = subparsers.add_parser('config',
        description="Configure git to use nbdime via `git mergetool`")
    config.add_argument('--global', action='store_true', dest='global_',
        help="configure your global git config instead of the current repo"
    )
    enable_disable = config.add_mutually_exclusive_group(required=True)
    enable_disable.add_argument('--enable', action='store_const',
        dest='config_func', const=enable,
        help="enable nbdime mergetool via git config"
    )
    enable_disable.add_argument('--disable', action='store_const',
        dest='config_func', const=disable,
        help="disable nbdime mergetool via git config"
    )
    opts = parser.parse_args()
    if opts.subcommand == 'merge':
        show_merge(opts.base, opts.local, opts.remote, opts.merged)
    elif opts.subcommand == 'config':
        opts.config_func(opts.global_)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
