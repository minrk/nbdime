#!/usr/bin/env python
# -*- coding:utf-8 -*-

from __future__ import print_function
from __future__ import unicode_literals

from argparse import ArgumentParser
import os.path
import webbrowser
import logging
import threading

from .nbdimeserver import main as run_server


_logger = logging.getLogger(__name__)


# TODO: Tool server starts on random port (in optionally specified port range)
# TODO: Tool server is passed a (mandatory?) single-use access token, which is
#       used to authenticate the browser session.

def build_arg_parser():
    """
    Creates an argument parser for the merge tool, that also lets the
    user specify a port and displays a help message.
    """
    description = 'mergetool for Nbdime.'
    parser = ArgumentParser(description=description)
    parser.add_argument('-p', '--port', default=8898,
                        help="Specify the port you want the server "
                             "to run on. Default is 8898.")
    parser.add_argument("local", help="The local file of the merge.")
    parser.add_argument("remote", help="The remote file of the merge.")
    parser.add_argument("base", help="The base file of the merge.")
    parser.add_argument("merged", help="The output file of the merge.")
    return parser


def browse(port):
    try:
        browser = webbrowser.get(None)
    except webbrowser.Error as e:
        _logger.warning('No web browser found: %s.', e)
        browser = None

    if browser:
        def launch_browser():
            browser.open("http://localhost:%s/mergetool" % port, new=2)
        threading.Thread(target=launch_browser).start()


def main():
    arguments = build_arg_parser().parse_args()
    port = arguments.port
    cwd = os.path.abspath(os.path.curdir)
    base = arguments.base
    local = arguments.local
    remote = arguments.remote
    merged = arguments.merged
    # can't handle non-notebook files
    # FIXME: ignore for now
    if (not base.endswith('.ipynb') and not local.endswith('.ipynb') and
            not remote.endswith('.ipynb')):
        print("Not notebooks: %r %r" % (local, remote))
        return
    browse(port)
    run_server(port=port, cwd=cwd,
               mergetool_args=dict(base=base, local=local, remote=remote),
               outputfilename=merged)

if __name__ == "__main__":
    main()
