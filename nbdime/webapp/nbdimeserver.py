#!/usr/bin/env python
# -*- coding:utf-8 -*-

from __future__ import print_function
from __future__ import unicode_literals

import os
import json
import sys
from argparse import ArgumentParser
from six import string_types
from tornado import ioloop, web, escape
import nbformat
import nbdime
from nbdime.merging.notebooks import decide_notebook_merge
from nbdime.nbmergeapp import _build_arg_parser


# TODO: See <notebook>/notebook/services/contents/handlers.py for possibly useful utilities:
#@json_errors
#contents_manager
#ContentsHandler
#APIHandler


here = os.path.abspath(os.path.dirname(__file__))
static_path = os.path.join(here, "static")
template_path = os.path.join(here, "templates")

builder = _build_arg_parser()
merge_args = builder.parse_args(["--strategy", "mergetool", "", "", ""])

exit_code = 0


def truncate_filename(name):
    limit = 20
    if len(name) < limit:
        return name
    else:
        return name[:limit-3] + "..."


class NbdimeApiHandler(web.RequestHandler):
    def initialize(self, **params):
        self.params = params

    def get_notebook_argument(self, argname):
        # Assuming a request on the form "{'argname':arg}"
        body = json.loads(escape.to_unicode(self.request.body))
        arg = body[argname]

        # Currently assuming arg is a filename relative to
        # where the server was started from, later we may
        # want to accept urls or full notebooks as well.
        if not isinstance(arg, string_types):
            raise web.HTTPError(400, "Expecting a filename.")

        # Check that file exists
        path = os.path.join(self.params["cwd"], arg)
        if not os.path.exists(path):
            raise web.HTTPError(400, "File doesn't exist: %s" % truncate_filename(arg))

        # Let nbformat do the reading and validation
        try:
            nb = nbformat.read(path, as_version=4)
        except:
            raise web.HTTPError(400, "Invalid notebook: %s" % truncate_filename(arg))

        return nb


class MainHandler(NbdimeApiHandler):
    def get(self):
        self.render("index.html")


class MainDiffHandler(NbdimeApiHandler):
    def get(self):
        args = {}
        args["base"] = self.get_argument("base", "")
        args["remote"] = self.get_argument("remote", "")
        self.render("diff.html", **args)


class MainDifftoolHandler(NbdimeApiHandler):
    def get(self):
        args = {}
        if "difftool_args" in self.params:
            args["base"] = self.params["difftool_args"]["base"]
            args["remote"] = self.params["difftool_args"]["remote"]
        else:
            args["base"] = self.get_argument("base", "")
            args["remote"] = self.get_argument("remote", "")
        self.render("difftool.html", **args)


class MainMergeHandler(NbdimeApiHandler):
    def get(self):
        args = {}
        args["base"] = self.get_argument("base", "")
        args["local"] = self.get_argument("local", "")
        args["remote"] = self.get_argument("remote", "")
        self.render("merge.html", **args)


class MainMergetoolHandler(NbdimeApiHandler):
    def get(self):
        args = {}
        if "mergetool_args" in self.params:
            args["base"] = self.params["mergetool_args"]["base"]
            args["local"] = self.params["mergetool_args"]["local"]
            args["remote"] = self.params["mergetool_args"]["remote"]
        else:
            args["base"] = self.get_argument("base", "")
            args["local"] = self.get_argument("local", "")
            args["remote"] = self.get_argument("remote", "")
        self.render("mergetool.html", **args)


class ApiDiffHandler(NbdimeApiHandler):
    def post(self):
        base_nb = self.get_notebook_argument("base")
        remote_nb = self.get_notebook_argument("remote")

        try:
            thediff = nbdime.diff_notebooks(base_nb, remote_nb)
        except Exception:
            raise web.HTTPError(400, "Error while diffing documents.")

        data = {
            "base": base_nb,
            "diff": thediff,
            }
        self.finish(data)


class ApiMergeHandler(NbdimeApiHandler):
    def post(self):
        base_nb = self.get_notebook_argument("base")
        local_nb = self.get_notebook_argument("local")
        remote_nb = self.get_notebook_argument("remote")

        try:
            decisions = decide_notebook_merge(base_nb, local_nb, remote_nb,
                                              args=merge_args)
        except Exception as e:
            raise web.HTTPError(400, "Error while attempting to merge documents: %s" % e)

        data = {
            "base": base_nb,
            "merge_decisions": decisions
            }
        self.finish(data)


class ApiMergeStoreHandler(NbdimeApiHandler):
    def post(self):
        # I don't think we want to accept arbitrary filenames
        # to write to from the http request, only allowing
        # this operation if the server was run with an output
        # filename as a commandline argument:
        fn = self.params.get("outputfilename", None)
        if not fn:
            raise web.HTTPError(400, "Server does not accept storing merge result.")
        path = os.path.join(self.params["cwd"], fn)

        body = json.loads(escape.to_unicode(self.request.body))
        merged = body["merged"]
        from pprint import pprint
        pprint(merged)
        merged_nb = nbformat.from_dict(merged)
        # Somehow store unsolved conflicts?
        # conflicts = body["conflicts"]

        with open(path, "w") as f:
            nbformat.write(merged_nb, f)
        self.finish()


class ApiCloseHandler(NbdimeApiHandler):
    def post(self):
        # Only allow closing, if started as tool
        if ("difftool_args" not in self.params and
                "mergetool_args" not in self.params):
            raise web.HTTPError(
                400, "Server is not a tool server, cannot be closed remotely.")

        global exit_code
        exit_code = self.request.headers.get("exit_code", 0)

        print("Closing tool")
        self.finish()
        ioloop.IOLoop.current().stop()


class NbdimeApp(web.Application):
    @property
    def connection_url(self):
        ip = self.ip if self.ip else 'localhost'
        return self._url(ip)

    def _url(self, ip):
        proto = 'https' if self.certfile else 'http'
        return "%s://%s:%i%s" % (proto, ip, self.port, self.base_url)


def make_app(**params):
    handlers = [
        (r"/", MainHandler, params),
        (r"/diff", MainDiffHandler, params),
        (r"/difftool", MainDifftoolHandler, params),
        (r"/merge", MainMergeHandler, params),
        (r"/mergetool", MainMergetoolHandler, params),
        (r"/api/diff", ApiDiffHandler, params),
        (r"/api/merge", ApiMergeHandler, params),
        (r"/api/store", ApiMergeStoreHandler, params),
        (r"/api/closetool", ApiCloseHandler, params),
        (r"/static", web.StaticFileHandler, {"path": static_path}),
    ]

    settings = {
        "static_path": static_path,
        "template_path": template_path,
        }

    DEBUGGING = 1
    if DEBUGGING:
        settings.update({
            "debug": True,
            })

    return web.Application(handlers, **settings)


def main(**params):
    print("Using params:")
    print(params)
    port = params.pop("port")
    app = make_app(**params)
    app.listen(port)
    ioloop.IOLoop.current().start()
    sys.exit(exit_code)


def build_arg_parser():
    """
    Creates an argument parser that lets the user specify a port
    and displays a help message.
    """
    description = 'Web interface for Nbdime.'
    parser = ArgumentParser(description=description)
    parser.add_argument('-p', '--port', default=8899,
                        help="Specify the port you want the server "
                             "to run on. Default is 8888.")
    return parser


if __name__ == "__main__":
    arguments = build_arg_parser().parse_args()
    cwd = os.path.abspath(os.path.curdir)
    main(port=arguments.port, cwd=cwd, outputfilename="")
