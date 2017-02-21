# -*- coding: utf-8 -*-

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

# Messes up tests by writing u'str':
#
from __future__ import print_function

try:
    from base64 import encodebytes
except ImportError:
    from base64 import encodestring as encodebytes
import os
from six import StringIO
from pprint import pformat
try:
    from unittest import mock
except ImportError:
    import mock

import hashlib

from nbformat import v4

from nbdime import prettyprint as pp
from nbdime.diffing import diff


def b64text(nbytes):
    """Return n bytes as base64-encoded text"""
    return encodebytes(os.urandom(nbytes)).decode('ascii')


def test_pretty_print_dict_complex():
    d = {
        'a': 5,
        'b': [1, 2, 3],
        'c': {
            'x': 'y',
        },
        'd': 10,
        'short': 'text',
        'long': 'long\ntext',
    }
    prefix = '-'

    io = StringIO()
    pp.pretty_print_dict(d, {'d'}, prefix, io)
    text = io.getvalue()

    print(text)
    for key in d:
        if key != 'd':
            mark = '-%s:' % key
            assert mark in text
    assert "short: text" in text
    assert 'long:\n' in text
    assert 'd:' not in text


def test_pretty_print_multiline_string_b64():
    ins = b64text(1024)
    prefix = '+'
    io = StringIO()
    pp.pretty_print_value(ins, prefix, io)
    text = io.getvalue()
    lines = text.splitlines(True)
    assert len(lines) == 1
    line = lines[0]
    assert line.startswith(prefix)
    assert len(line) < 100
    assert 'snip base64' in line


def test_pretty_print_multiline_string_short():
    ins = 'short string'
    prefix = '+'

    io = StringIO()
    pp.pretty_print_value_at(ins, "no/addr", prefix, io)
    text = io.getvalue()
    lines = text.splitlines(False)

    assert lines == [prefix + ins]


def test_pretty_print_multiline_string_long():
    ins = '\n'.join('line %i' % i for i in range(64))
    prefix = '+'
    io = StringIO()
    pp.pretty_print_value(ins, prefix, io)
    text = io.getvalue()
    lines = text.splitlines(False)
    assert len(lines) == 64
    assert (prefix + 'line 32') in lines


def test_pretty_print_value_int():
    v = 5
    assert pp.format_value(v) == '5'
    io = StringIO()
    pp.pretty_print_value(v, "+", io)
    text = io.getvalue()
    print("'%s'" % text)
    assert "+5" in text
    # path is only used for dispatching to special formatters
    assert "dummypath" not in text


def test_format_value_int():
    assert pp.format_value(5) == "5"


def test_format_value_str():
    assert pp.format_value("xyz") == "xyz"


def _pretty_print(value, prefix="+", path="/dummypath"):
    io = StringIO()
    pp.pretty_print_value_at(value, path, prefix, io)
    text = io.getvalue()
    return text


def test_pretty_print_str():
    assert _pretty_print("x", "+") == "+x\n"


def test_pretty_print_dict():
    d = {'key': 5}
    text = _pretty_print(d, "+")
    assert text == "+key: 5\n"


def test_pretty_print_dict_longstrings():
    d = { "0": 'a\nb', "1": 'c\nd' }
    text = _pretty_print(d, "+")
    assert text == "+0:\n+  a\n+  b\n+1:\n+  c\n+  d\n"


def test_pretty_print_list():
    lis = ['a', 'b']
    text = _pretty_print(lis, "+")
    assert text == "+['a', 'b']\n"


def test_pretty_print_list_longstrings():
    lis = ['a\nb', 'c\nd']
    text = _pretty_print(lis, "+")
    assert text == "+item[0]:\n+  a\n+  b\n+item[1]:\n+  c\n+  d\n"


def test_pretty_print_stream_output():
    output = v4.new_output('stream', name='stdout', text='some\ntext')

    io = StringIO()
    pp.pretty_print_value_at(output, "/cells/2/outputs/3", "+", io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines == [
        '+output:',
        '+  output_type: stream',
        "+  name: stdout",
        "+  text:",
        "+    some",
        "+    text",
    ]


def test_pretty_print_display_data():
    output = v4.new_output('display_data', {
        'text/plain': 'text',
        'image/png': b64text(1024),
    })

    io = StringIO()
    pp.pretty_print_value_at(output, "/cells/1/outputs/2", "+", io)
    text = io.getvalue()
    lines = text.splitlines()

    assert 'output_type: display_data' in text
    assert len(text) < 500
    assert 'snip base64' in text
    assert 'image/png' in text
    assert "text/plain: text" in text
    assert all(line.startswith('+') for line in lines if line)


def test_pretty_print_markdown_cell():
    cell = v4.new_markdown_cell(source='# Heading\n\n*some markdown*')

    io = StringIO()
    pp.pretty_print_value_at(cell, "/cells/0", "+", io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines[0] == '+markdown cell:'
    assert all(line.startswith('+') for line in lines if line)
    assert 'source:' in text
    assert '+    # Heading' in text
    assert '+    ' in lines
    assert '+    *some markdown*' in text


def test_pretty_print_code_cell():
    cell = v4.new_code_cell(source='def foo():\n    return 4',
        execution_count=3,
        outputs=[
            v4.new_output('stream', name='stdout', text='some\ntext'),
            v4.new_output('display_data', {'text/plain': 'hello display'}),
        ]
    )

    io = StringIO()
    pp.pretty_print_value_at(cell, "/cells/0", "+", io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines == [
        '+code cell:',
        '+  execution_count: 3',
        '+  source:',
        '+    def foo():',
        '+        return 4',
        '+  outputs:',
        '+    output 0:',
        '+      output_type: stream',
        '+      name: stdout',
        '+      text:',
        '+        some',
        '+        text',
        '+    output 1:',
        '+      output_type: display_data',
        '+      data:',
        '+        text/plain: hello display',
    ]


def test_pretty_print_dict_diff(nocolor):
    a = {'a': 1}
    b = {'a': 2}
    di = diff(a, b, path='x/y')

    io = StringIO()
    pp.pretty_print_diff(a, di, 'x/y', io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines == [
        '## replaced x/y/a:',
        '-  1',
        '+  2',
        '',
    ]


def test_pretty_print_list_diff(nocolor):
    a = [1]
    b = [2]
    path = '/a/b'
    di = diff(a, b, path=path)

    io = StringIO()
    pp.pretty_print_diff(a, di, path, io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines == [
        '## inserted before /a/b/0:',
        '+  [2]',
        '',
        '## deleted /a/b/0:',
        '-  [1]',
        '',
    ]


def test_pretty_print_list_multilinestrings(nocolor):
    a = ["ac\ndf", "qe\nry", 2]
    b = [2, "abc\ndef", "qwe\nrty"]
    path = '/a/b'
    di = diff(a, b, path=path)

    io = StringIO()
    pp.pretty_print_diff(a, di, path, io)
    text = io.getvalue()
    lines = text.splitlines()

    assert lines == [
        '## deleted /a/b/0-1:',
        #'-  ["ac\ndf", "qe\nry"]',
        #'-  b[0]:',
        '-  item[0]:',
        '-    ac',
        '-    df',
        #'-  b[1]:',
        '-  item[1]:',
        '-    qe',
        '-    ry',
        '',
        '## inserted before /a/b/3:',
        #'+  ["abc\ndef", "qwe\nrty"]',
        #'+  b[3+0]:',
        '+  item[0]:',
        '+    abc',
        '+    def',
        #'+  b[3+1]:',
        '+  item[1]:',
        '+    qwe',
        '+    rty',
        '',
    ]


def test_pretty_print_string_diff(nocolor):
    a = '\n'.join(['line 1', 'line 2', 'line 3', ''])
    b = '\n'.join(['line 1', 'line 3', 'line 4', ''])
    path = '/a/b'
    di = diff(a, b, path=path)

    with mock.patch('nbdime.prettyprint.which', lambda cmd: None):
        io = StringIO()
        pp.pretty_print_diff(a, di, path, io)
        text = io.getvalue()
        lines = text.splitlines()

    text = '\n'.join(lines)
    assert ('< line 2' in text) or ((pp.REMOVE + 'line 2' + pp.RESET) in text)
    assert ('> line 4' in text) or ((pp.ADD + 'line 4' + pp.RESET) in text)


def test_pretty_print_string_diff_b64(nocolor):
    a = b64text(1024)
    b = b64text( 800)
    path = '/a/b'
    di = diff(a, b, path=path)

    io = StringIO()
    pp.pretty_print_diff(a, di, path, io)
    text = io.getvalue()
    lines = text.splitlines()

    ha = pp.hash_string(a)
    hb = pp.hash_string(b)

    assert lines == [
        '## modified /a/b:',
        '-  %s...<snip base64, md5=%s...>' % (a[:8], ha[:16]),
        '+  %s...<snip base64, md5=%s...>' % (b[:8], hb[:16]),
        '',
    ]
