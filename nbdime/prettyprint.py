# -*- coding: utf-8 -*-

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

import sys
import io
import os
import datetime
import pprint
import re
import shutil
from subprocess import Popen, PIPE
import tempfile
from difflib import unified_diff
from six import string_types
import hashlib

try:
    from shutil import which
except ImportError:
    from backports.shutil_which import which

from .diff_format import NBDiffFormatError, DiffOp, op_patch
from .patching import patch, patch_string
from .utils import star_path, split_path, join_path
from .utils import as_text, as_text_lines
from .log import warning

# TODO: Make this configurable
use_git = True
use_diff = True
use_colors = True

# Indentation offset in pretty-print
IND = "  "

# Max line width used some placed in pretty-print
# TODO: Use this for line wrapping some places?
MAXWIDTH = 78

git_diff_print_cmd = 'git diff --no-index --color-words before after'
diff_print_cmd = 'diff before after'
git_mergefile_print_cmd = 'git merge-file -p local base remote'
diff3_print_cmd = 'diff3 -m local base remote'

if use_colors:
    import colorama
    RED = colorama.Fore.RED
    GREEN = colorama.Fore.GREEN
    BLUE = colorama.Fore.BLUE
    YELLOW = colorama.Fore.YELLOW
    RESET = colorama.Style.RESET_ALL

else:
    RED = ''
    GREEN = ''
    BLUE = ''
    YELLOW = ''
    RESET = ''
    git_diff_print_cmd = git_diff_print_cmd.replace(" --color-words ", "")


KEEP     = '{color}   '.format(color='')
REMOVE   = '{color}-  '.format(color=RED)
ADD      = '{color}+  '.format(color=GREEN)
INFO     = '{color}## '.format(color=BLUE)
DIFF_ENTRY_END = '\n'


def external_merge_render(cmd, b, l, r):
    b = as_text(b)
    l = as_text(l)
    r = as_text(r)
    td = tempfile.mkdtemp()
    try:
        with io.open(os.path.join(td, 'local'), 'w', encoding="utf8") as f:
            f.write(l)
        with io.open(os.path.join(td, 'base'), 'w', encoding="utf8") as f:
            f.write(b)
        with io.open(os.path.join(td, 'remote'), 'w', encoding="utf8") as f:
            f.write(r)
        assert all(fn in cmd for fn in ['local', 'base', 'remote'])
        p = Popen(cmd, cwd=td, stdout=PIPE)
        output, errors = p.communicate()
        status = p.returncode
        output = output.decode('utf8')
        # normalize newlines
        output = output.replace('\r\n', '\n')
    finally:
        shutil.rmtree(td)
    return output, status


def external_diff_render(cmd, a, b):
    a = as_text(a)
    b = as_text(b)
    td = tempfile.mkdtemp()
    try:
        with io.open(os.path.join(td, 'before'), 'w', encoding="utf8") as f:
            f.write(a)
        with io.open(os.path.join(td, 'after'), 'w', encoding="utf8") as f:
            f.write(b)
        assert all(fn in cmd for fn in ['before', 'after'])
        p = Popen(cmd, cwd=td, stdout=PIPE)
        output, errors = p.communicate()
        status = p.returncode
        output = output.decode('utf8')
        r = re.compile(r"^\\ No newline at end of file\n?", flags=re.M)
        output, n = r.subn("", output)
        assert n <= 2
    finally:
        shutil.rmtree(td)
    return output, status


def format_merge_render_lines(
        base, local, remote,
        base_title, local_title, remote_title,
        marker_size, include_base):
    sep0 = "<"*marker_size
    sep1 = "|"*marker_size
    sep2 = "="*marker_size
    sep3 = ">"*marker_size

    orig_local = local
    orig_remote = remote

    if local and local[-1].endswith('\n'):
        local[-1] = local[-1] + '\n'
    if remote and remote[-1].endswith('\n'):
        remote[-1] = remote[-1] + '\n'

    # Extract equal lines at beginning
    prelines = []
    i = 0
    n = min(len(local), len(remote))
    while i < n and local[i] == remote[i]:
        prelines.append(local[i])
        i += 1
    local = local[i:]
    remote = remote[i:]

    # Extract equal lines at end
    postlines = []
    i = len(local) - 1
    j = len(remote) - 1
    while (i >= 0 and i < len(local) and
            j >= 0 and j < len(remote) and
            local[i] == remote[j]):
        postlines.append(local[i])
        i += 1
        j += 1
    postlines = reversed(postlines)
    local = local[:i+1]
    remote = remote[:j+1]

    lines = []
    lines.extend(prelines)

    sep0 = "%s %s\n" % (sep0, local_title)
    lines.append(sep0)
    lines.extend(local)

    # This doesn't take prelines and postlines into account
    # if include_base:
    #     sep1 = "%s %s\n" % (sep1, base_title)
    #     lines.append(sep1)
    #     lines.extend(base)

    sep2 = "%s\n" % (sep2,)
    lines.append(sep2)
    lines.extend(remote)

    sep3 = "%s %s\n" % (sep3, remote_title)
    lines.append(sep3)

    lines.extend(postlines)

    # Make sure all but the last line ends with newline
    for i in range(len(lines)):
        if not lines[i].endswith('\n'):
            lines[i] = lines[i] + '\n'
    if lines:
        lines[-1] = lines[-1].rstrip("\r\n")

    return lines


def builtin_merge_render(base, local, remote, strategy=None):
    if local == remote:
        return local, 0

    # In this extremely simplified merge rendering,
    # we currently define conflict as local != remote

    if strategy == "use-local":
        return local, 0
    elif strategy == "use-remote":
        return remote, 0
    elif strategy is not None:
        warning("Using builtin merge render but ignoring strategy %s" % (strategy,))

    # Styling
    local_title = "local"
    base_title = "base"
    remote_title = "remote"
    marker_size = 7  # git uses 7 by default

    include_base = False  # TODO: Make option

    local = as_text_lines(local)
    base = as_text_lines(base)
    remote = as_text_lines(remote)

    lines = format_merge_render_lines(
        base, local, remote,
        base_title, local_title, remote_title,
        marker_size, include_base
        )

    merged = "".join(lines)
    return merged, 1


def builtin_diff_render(a, b):
    gen = unified_diff(
        a.splitlines(False),
        b.splitlines(False),
        lineterm='')
    uni = []
    for line in gen:
        if line.startswith('+'):
            uni.append("%s%s%s" % (ADD, line[1:], RESET))
        elif line.startswith('-'):
            uni.append("%s%s%s" % (REMOVE, line[1:], RESET))
        elif line.startswith(' '):
            uni.append("%s%s%s" % (KEEP, line[1:], RESET))
        elif line.startswith('@'):
            uni.append(line)
        else:
            # Don't think this will happen?
            uni.append("%s%s%s" % (KEEP, line[1:], RESET))
    return '\n'.join(uni)


def diff_render_with_git(a, b):
    cmd = git_diff_print_cmd
    diff, status = external_diff_render(cmd.split(), a, b)
    return "".join(diff.splitlines(True)[4:])


def diff_render_with_diff(a, b):
    cmd = diff_print_cmd
    return external_diff_render(cmd.split(), a, b)


def diff_render_with_difflib(a, b):
    diff = builtin_diff_render(a, b)
    return "".join(diff.splitlines(True)[2:])


def diff_render(a, b):
    if use_git and which('git'):
        return diff_render_with_git(a, b)
    elif use_diff and which('diff'):
        return diff_render_with_diff(a, b)
    else:
        return diff_render_with_difflib(a, b)


def merge_render_with_git(b, l, r, strategy=None):
    # Note: git merge-file also takes argument -L to change label if needed
    cmd = git_mergefile_print_cmd
    if strategy == "use-local":
        cmd += " --ours"
    elif strategy == "use-remote":
        cmd += " --theirs"
    elif strategy == "union":
        cmd += " --union"
    elif strategy is not None:
        warning("Using git merge-file but ignoring strategy %s", strategy)
    merged, status = external_merge_render(cmd.split(), b, l, r)

    # Remove trailing newline if ">>>>>>> remote" is the last line
    lines = merged.splitlines(True)
    if "\n" in lines[-1] and (">"*7) in lines[-1]:
        merged = merged.rstrip()
    return merged, status


def merge_render_with_diff3(b, l, r, strategy=None):
    # Note: diff3 also takes argument -L to change label if needed
    cmd = diff3_print_cmd
    if strategy == "use-local":
        return l, 0
    elif strategy == "use-remote":
        return r, 0
    elif strategy is not None:
        warning("Using diff3 but ignoring strategy %s", strategy)
    merged, status = external_merge_render(cmd.split(), b, l, r)
    return merged, status


def merge_render(b, l, r, strategy=None):
    if strategy == "use-base":
        return b, 0
    if use_git and which('git'):
        return merge_render_with_git(b, l, r, strategy)
    elif use_diff and which('diff3'):
        return merge_render_with_diff3(b, l, r, strategy)
    else:
        return builtin_merge_render(b, l, r, strategy)


def file_timestamp(filename):
    "Return modification time for filename as a string."
    if os.path.exists(filename):
        t = os.path.getmtime(filename)
        dt = datetime.datetime.fromtimestamp(t)
        return dt.isoformat(str(" "))
    else:
        return "(no timestamp)"


def hash_string(s):
    return hashlib.md5(s.encode("utf8")).hexdigest()

_base64 = re.compile(r'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$', re.MULTILINE | re.UNICODE)

def _trim_base64(s):
    """Trim and hash base64 strings"""
    if len(s) > 64 and _base64.match(s.replace('\n', '')):
        h = hash_string(s)
        s = '%s...<snip base64, md5=%s...>' % (s[:8], h[:16])
    return s


def format_value(v):
    "Format simple value for printing. Snips base64 strings and uses pprint for the rest."
    if not isinstance(v, string_types):
        # Not a string, defer to pprint
        vstr = pprint.pformat(v)
    else:
        # Snip if base64 data
        vstr = _trim_base64(v)
    return vstr


def pretty_print_value(value, prefix="", out=sys.stdout):
    """Print a possibly complex value with all lines prefixed.

    Calls out to generic formatters based on value
    type for dicts, lists, and multiline strings.
    Uses format_value for simple values.
    """
    if isinstance(value, dict):
        pretty_print_dict(value, (), prefix, out)
    elif isinstance(value, list) and value:
        pretty_print_list(value, prefix, out)
    else:
        pretty_print_multiline(format_value(value), prefix, out)


def pretty_print_value_at(value, path, prefix="", out=sys.stdout):
    """Print a possibly complex value with all lines prefixed.

    Calls out to other specialized formatters based on path
    for cells, outputs, attachments, and more generic formatters
    based on type for dicts, lists, and multiline strings.
    Uses format_value for simple values.
    """
    # Format starred version of path
    if path is None:
        starred = None
    else:
        if path.startswith('/'):
            path_prefix, path_trail = ('', path)
        else:
            path_prefix, path_trail = path.split('/', 1)
        starred = star_path(split_path(path_trail))

    # Check if we can handle path with specific formatter
    if starred is not None:
        if starred == "/cells/*":
            pretty_print_cell(None, value, prefix, out)
        elif starred == "/cells":
            for cell in value:
                pretty_print_cell(None, cell, prefix, out)
        elif starred == "/cells/*/outputs/*":
            pretty_print_output(None, value, prefix, out)
        elif starred == "/cells/*/outputs":
            for output in value:
                pretty_print_output(None, output, prefix, out)
        elif starred == "/cells/*/attachments":
            pretty_print_attachments(value, prefix, out)
        else:
            starred = None

    if starred is None:
        pretty_print_value(value, prefix, out)


def pretty_print_key(k, prefix, out):
    out.write("%s%s:\n" % (prefix, k))


def pretty_print_key_value(k, v, prefix="", out=sys.stdout):
    out.write("%s%s: %s\n" % (prefix, k, v))


def pretty_print_diff_action(msg, path, out):
    out.write("%s%s %s:%s\n" % (INFO, msg, path, RESET))


def pretty_print_item(k, v, prefix="", out=sys.stdout):
    if isinstance(v, dict):
        pretty_print_key(k, prefix, out)
        pretty_print_dict(v, (), prefix+IND, out)
    elif isinstance(v, list):
        pretty_print_key(k, prefix, out)
        pretty_print_list(v, prefix+IND, out)
    else:
        vstr = format_value(v)
        if "\n" in vstr:
            # Multiline strings
            pretty_print_key(k, prefix, out)
            for line in vstr.splitlines(False):
                out.write("%s%s\n" % (prefix+IND, line))
        else:
            # Singleline strings
            pretty_print_key_value(k, vstr, prefix, out)


def pretty_print_multiline(text, prefix="", out=sys.stdout):
    assert isinstance(text, string_types)

    # Preprend prefix to lines, letting lines keep their own newlines
    lines = text.splitlines(True)
    for line in lines:
        out.write(prefix + line)

    # If the final line doesn't have a newline,
    # make sure we still start a new line
    if not text.endswith("\n"):
        out.write("\n")


def pretty_print_list(li, prefix="", out=sys.stdout):
    listr = pprint.pformat(li)
    if len(listr) < MAXWIDTH - len(prefix) and "\\n" not in listr:
        out.write("%s%s\n" % (prefix, listr))
    else:
        for k, v in enumerate(li):
            pretty_print_item("item[%d]" % k, v, prefix, out)


def pretty_print_dict(d, exclude_keys=(), prefix="", out=sys.stdout):
    """Pretty-print a dict without wrapper keys

    Instead of {'key': 'value'}, do

        key: value
        key:
          long
          value

    """
    for k in sorted(set(d) - set(exclude_keys)):
        v = d[k]
        pretty_print_item(k, v, prefix, out)


def pretty_print_metadata(md, known_keys, prefix="", out=sys.stdout):
    md1 = {}
    md2 = {}
    for k in md:
        if k in known_keys:
            md1[k] = md[k]
        else:
            md2[k] = md[k]
    if md1:
        pretty_print_key("metadata (known keys)", prefix, out)
        pretty_print_dict(md1, (), prefix+IND, out)
    if md2:
        pretty_print_key("metadata (unknown keys)", prefix, out)
        pretty_print_dict(md2, (), prefix+IND, out)


def pretty_print_output(i, output, prefix="", out=sys.stdout):
    oprefix = prefix+IND
    numstr = "" if i is None else " %d" % i
    k = "output%s" % (numstr,)
    pretty_print_key(k, prefix, out)

    item_keys = ("output_type", "execution_count",
                 "name", "text", "data",
                 "ename", "evalue", "traceback")
    for k in item_keys:
        v = output.get(k)
        if v:
            pretty_print_item(k, v, oprefix, out)

    exclude_keys = {"output_type", "metadata", "traceback"} | set(item_keys)

    metadata = output.get("metadata")
    if metadata:
        known_output_metadata_keys = {"isolated"}
        pretty_print_metadata(metadata, known_output_metadata_keys, oprefix, out)

    pretty_print_dict(output, exclude_keys, oprefix, out)


def pretty_print_outputs(outputs, prefix="", out=sys.stdout):
    pretty_print_key("outputs", prefix, out)
    for i, output in enumerate(outputs):
        pretty_print_output(i, output, prefix+IND, out)


def pretty_print_attachments(attachments, prefix="", out=sys.stdout):
    pretty_print_key("attachments", prefix, out)
    for name in sorted(attachments):
        pretty_print_item(name, attachments[name], prefix+IND, out)


def pretty_print_source(source, prefix="", out=sys.stdout):
    pretty_print_key("source", prefix, out)
    pretty_print_multiline(source, prefix+IND, out)


def pretty_print_cell(i, cell, prefix="", out=sys.stdout, args=None):
    key_prefix = prefix+IND

    def c():
        "Write cell header first time this is called."
        if not c.called:
            # Write cell type and optionally number:
            numstr = "" if i is None else " %d" % i
            k = "%s cell%s" % (cell.cell_type, numstr)
            pretty_print_key(k, prefix, out)
            c.called = True
    c.called = False

    execution_count = cell.get("execution_count")
    if execution_count and (args is None or args.details):
        # Write execution count if there (only source cells)
        c()
        pretty_print_item("execution_count", execution_count, key_prefix, out)

    metadata = cell.get("metadata")
    if metadata and (args is None or args.metadata):
        # Write cell metadata
        c()
        known_cell_metadata_keys = {"collapsed", "autoscroll", "deletable", "format", "name", "tags"}
        pretty_print_metadata(cell.metadata, known_cell_metadata_keys, key_prefix, out)

    source = cell.get("source")
    if source and (args is None or args.sources):
        # Write source
        c()
        pretty_print_source(source, key_prefix, out)

    attachments = cell.get("attachments")
    if attachments and (args is None or args.attachments):
        # Write attachment if there (only markdown and raw cells)
        c()
        pretty_print_attachments(attachments, key_prefix, out)

    outputs = cell.get("outputs")
    if outputs and (args is None or args.outputs):
        # Write outputs if there (only source cells)
        c()
        pretty_print_outputs(outputs, key_prefix, out)

    exclude_keys = {'cell_type', 'source', 'execution_count', 'outputs', 'metadata', 'attachment'}
    if (set(cell) - exclude_keys) and (args is None or args.details):
        # present anything we haven't special-cased yet (future-proofing)
        c()
        pretty_print_dict(cell, exclude_keys, key_prefix, out)


def pretty_print_notebook(nb, args=None, out=sys.stdout):
    """Pretty-print a notebook for debugging, skipping large details in metadata and output

    Parameters
    ----------

    nb: dict
        The notebook object
    args: argparse Namespace or similar object
        Arguments to turn on/off showing parts of notebook, including:
        args.sources, args.outputs, args.attachments, args.metadata, args.details
    out: file-like object
        File-like object with .write function used for output.
    """
    prefix = ""

    if args is None or args.details:
        # Write notebook header
        v = "%d.%d" % (nb.nbformat, nb.nbformat_minor)
        pretty_print_key_value("notebook format", v, prefix, out)

    # Report unknown keys
    unknown_keys = set(nb.keys()) - {"nbformat", "nbformat_minor", "metadata", "cells"}
    if unknown_keys:
        pretty_print_key_value("unknown keys", repr(unknown_keys), prefix, out)

    if args is None or args.metadata:
        # Write notebook metadata
        known_metadata_keys = {"kernelspec", "language_info"}
        pretty_print_metadata(nb.metadata, known_metadata_keys, "", out)

    # Write notebook cells
    for i, cell in enumerate(nb.cells):
        pretty_print_cell(i, cell, prefix="", out=out, args=args)


def pretty_print_diff_entry(a, e, path, out=sys.stdout):
    key = e.key
    nextpath = "/".join((path, str(key)))
    op = e.op

    # Recurse to handle patch ops
    if op == DiffOp.PATCH:
        # Useful for debugging:
        #if not (len(e.diff) == 1 and e.diff[0].op == DiffOp.PATCH):
        #    out.write("{}// patch -+{} //{}\n".format(INFO, nextpath, RESET))
        #else:
        #    out.write("{}// patch... -+{} //{}\n".format(INFO, nextpath, RESET))
        pretty_print_diff(a[key], e.diff, nextpath, out)
        return

    if op == DiffOp.ADDRANGE:
        pretty_print_diff_action("inserted before", nextpath, out)
        pretty_print_value_at(e.valuelist, path, ADD, out)

    elif op == DiffOp.REMOVERANGE:
        if e.length > 1:
            keyrange = "{}-{}".format(nextpath, key + e.length - 1)
        else:
            keyrange = nextpath
        pretty_print_diff_action("deleted", keyrange, out)
        pretty_print_value_at(a[key: key + e.length], path, REMOVE, out)

    elif op == DiffOp.REMOVE:
        pretty_print_diff_action("deleted", nextpath, out)
        pretty_print_value_at(a[key], nextpath, REMOVE, out)

    elif op == DiffOp.ADD:
        pretty_print_diff_action("added", nextpath, out)
        pretty_print_value_at(e.value, nextpath, ADD, out)

    elif op == DiffOp.REPLACE:
        aval = a[key]
        bval = e.value
        if type(aval) != type(bval):
            typechange = " (type changed from %s to %s)" % (
                aval.__class__.__name__, bval.__class__.__name__)
        else:
            typechange = ""
        pretty_print_diff_action("replaced" + typechange, nextpath, out)
        pretty_print_value_at(aval, nextpath, REMOVE, out)
        pretty_print_value_at(bval, nextpath, ADD, out)

    else:
        raise NBDiffFormatError("Unknown list diff op {}".format(op))

    out.write(DIFF_ENTRY_END + RESET)


def pretty_print_dict_diff(a, di, path, out=sys.stdout):
    "Pretty-print a nbdime diff."
    for key, e in sorted([(e.key, e) for e in di], key=lambda x: x[0]):
        pretty_print_diff_entry(a, e, path, out)


def pretty_print_list_diff(a, di, path, out=sys.stdout):
    "Pretty-print a nbdime diff."
    for e in di:
        pretty_print_diff_entry(a, e, path, out)


def pretty_print_string_diff(a, di, path, out=sys.stdout):
    "Pretty-print a nbdime diff."
    pretty_print_diff_action("modified", path, out)

    b = patch(a, di)

    ta = _trim_base64(a)
    tb = _trim_base64(b)

    if ta != a or tb != b:
        if ta != a:
            out.write('%s%s\n' % (REMOVE, ta))
        else:
            pretty_print_value_at(a, path, REMOVE, out)
        if tb != b:
            out.write('%s%s\n' % (ADD, tb))
        else:
            pretty_print_value_at(b, path, ADD, out)
    elif "\n" in a or "\n" in b:
        # Delegate multiline diff formatting
        diff = diff_render(a, b)
        out.write(diff)
    else:
        # Just show simple -+ single line (usually metadata values etc)
        out.write("%s%s\n" % (REMOVE, a))
        out.write("%s%s\n" % (ADD, b))

    out.write(DIFF_ENTRY_END + RESET)


def pretty_print_diff(a, di, path, out=sys.stdout):
    "Pretty-print a nbdime diff."
    if isinstance(a, dict):
        pretty_print_dict_diff(a, di, path, out)
    elif isinstance(a, list):
        pretty_print_list_diff(a, di, path, out)
    elif isinstance(a, string_types):
        pretty_print_string_diff(a, di, path, out)
    else:
        raise NBDiffFormatError("Invalid type {} for diff presentation.".format(type(a)))


notebook_diff_header = """\
nbdiff {afn} {bfn}
--- {afn}{atime}
+++ {bfn}{btime}
"""

def pretty_print_notebook_diff(afn, bfn, a, di, out=sys.stdout):
    """Pretty-print a notebook diff

    Parameters
    ----------

    afn: str
        Filename of a, the base notebook
    bfn: str
        Filename of b, the updated notebook
    a: dict
        The base notebook object
    di: diff
        The diff object describing the transformation from a to b
    """
    if di:
        path = ""
        atime = "  " + file_timestamp(afn)
        btime = "  " + file_timestamp(bfn)
        out.write(notebook_diff_header.format(afn=afn, bfn=bfn, atime=atime, btime=btime))
        pretty_print_diff(a, di, path, out)


def pretty_print_merge_decision(base, decision, out=sys.stdout):
    prefix = IND

    path = join_path(decision.common_path)
    confnote = "conflicted " if decision.conflict else ""
    out.write("%s%sdecision at %s:%s\n" % (INFO.replace("##", "===="), confnote, path, RESET))

    diff_keys = ("diff", "local_diff", "remote_diff", "custom_diff")
    exclude_keys = set(diff_keys) | {"common_path", "action", "conflict"}
    pretty_print_dict(decision, exclude_keys, prefix, out)

    for dkey in diff_keys:
        diff = decision.get(dkey)

        if (dkey == "remote_diff" and decision.action == "either" and
                diff == decision.get("local_diff")):
            # Skip remote diff
            continue
        elif (dkey == "local_diff" and decision.action == "either" and
                diff == decision.get("remote_diff")):
            note = " (same as remote_diff)"
        elif dkey.startswith(decision.action):
            note = " (selected)"
        else:
            note = ""

        if diff:
            out.write("%s%s%s:%s\n" % (INFO.replace("##", "---"), dkey, note, RESET))
            value = base
            for i, k in enumerate(decision.common_path):
                if isinstance(value, string_types):
                    # Example case:
                    #   common_path = /cells/0/source/3
                    #   value = nb.cells[0].source
                    #   k = line number 3
                    #   k is last item in common_path
                    assert i == len(decision.common_path) - 1

                    # Diffs on strings are usually line-based, _except_
                    # when common_path points to a line within a string.
                    # Wrap character based diff in a patch op with line
                    # number to normalize.
                    diff = [op_patch(k, diff)]
                    break
                else:
                    # Either a list or dict, get subvalue
                    value = value[k]
            pretty_print_diff(value, diff, path, out)


#def pretty_print_string_diff(string, lineno, diff, out):
#    line = string.splitlines(True)[lineno]
#    pretty_print_diff_entry(e)


def pretty_print_merge_decisions(base, decisions, out=sys.stdout):
    """Pretty-print notebook merge decisions

    Parameters
    ----------

    base: dict
        The base notebook object
    decisions: list
        The list of merge decisions
    """
    conflicted = [d for d in decisions if d.conflict]
    out.write("%d conflicted decisions of %d total:\n"
              % (len(conflicted), len(decisions)))
    for d in decisions:
        pretty_print_merge_decision(base, d, out)


def pretty_print_notebook_merge(bfn, lfn, rfn, bnb, lnb, rnb, mnb, decisions, out=sys.stdout):
    """Pretty-print a notebook merge

    Parameters
    ----------

    bfn: str
        Filename of the base notebook
    lfn: str
        Filename of the local notebook
    rfn: str
        Filename of the remote notebook
    bnb: dict
        The base notebook object
    lnb: dict
        The local notebook object
    rnb: dict
        The remote notebook object
    mnb: dict
        The partially merged notebook object
    decisions: list
        The list of merge decisions including conflicts
    """
    pretty_print_merge_decisions(bnb, decisions, out)
