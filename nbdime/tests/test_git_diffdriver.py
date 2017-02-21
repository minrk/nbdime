# -*- coding: utf-8 -*-

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

try:
    from shutil import which
except ImportError:
    from backports.shutil_which import which

import pytest
import mock
import os
from os.path import join as pjoin

from nbdime.gitdiffdriver import main as gdd_main
from nbdime.prettyprint import file_timestamp


# Expected output includes coloring characters
expected_output = """nbdiff {0} {1}
--- {0}  {2}
+++ {1}  {3}
## modified /cells/0/outputs/0/data/text/plain:
-  6
+  3

## modified /cells/0/source:
@@ -1,3 +1,3 @@
-def foe(x, y):
+def foo(x, y):
     return x + y
-foe(3, 2)
+foo(1, 2)

## modified /cells/1/source:
@@ -1,3 +1,3 @@
-def foo(x, y):
+def foe(x, y):
     return x * y
-foo(1, 2)
+foe(1, 2)

"""

@pytest.mark.skipif(not which('git'), reason="Missing git.")
def test_git_diff_driver(capsys, nocolor):
    # Simulate a call from `git diff` to check basic driver functionality
    test_dir = os.path.abspath(os.path.dirname(__file__))

    fn1 = pjoin(test_dir, 'files/foo--1.ipynb')
    fn2 = pjoin(test_dir, 'files/foo--2.ipynb')
    t1 = file_timestamp(fn1)
    t2 = file_timestamp(fn2)

    mock_argv = [
        '/mock/path/git-nbdiffdriver', 'diff',
        fn1,
        fn1, 'invalid_mock_checksum', '100644',
        fn2, 'invalid_mock_checksum', '100644']

    with mock.patch('sys.argv', mock_argv):
        r = gdd_main()
        assert r == 0
        cap_out = capsys.readouterr()[0]
        assert cap_out == expected_output.format(fn1, fn2, t1, t2)
