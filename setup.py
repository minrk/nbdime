#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import print_function

# the name of the project
name = 'nbdime'

#-----------------------------------------------------------------------------
# Minimal Python version sanity check
#-----------------------------------------------------------------------------

import sys

v = sys.version_info
if v[:2] < (2,7) or (v[0] >= 3 and v[:2] < (3,3)):
    error = "ERROR: %s requires Python version 2.7 or 3.3 or above." % name
    print(error, file=sys.stderr)
    sys.exit(1)

PY3 = (sys.version_info[0] >= 3)

#-----------------------------------------------------------------------------
# get on with it
#-----------------------------------------------------------------------------

import os
from glob import glob
from subprocess import check_call

from distutils import log
from distutils.core import setup
from distutils.cmd import Command
from distutils.command.build import build
from distutils.command.sdist import sdist

pjoin = os.path.join
here = os.path.abspath(os.path.dirname(__file__))
pkg_root = pjoin(here, name)


def run(cmd, cwd=None):
    """Run a command

    >>> run('npm install', cwd='./subdir')
    """
    # On Windows, shell should be True so that the path is searched for the command.
    shell = (sys.platform == 'win32')
    check_call(cmd.split(), shell=shell, cwd=cwd, stdout=sys.stdout, stderr=sys.stderr)


def js_prerelease(command):
    """Decorator for building minified js/css prior to another command"""
    class DecoratedCommand(command):
        def run(self):
            self.distribution.run_command('jsdeps')
            command.run(self)

    return DecoratedCommand


def install_npm(path):
    """Return a Command for running npm install and npm build at a given path."""

    class NPM(Command):
        description = 'install package.json dependencies using npm'
        user_options = []

        node_package = path
        node_modules = pjoin(node_package, 'node_modules')

        def initialize_options(self):
            pass

        def finalize_options(self):
            pass

        def has_npm(self):
            try:
                run('npm --version')
                return True
            except:
                return False

        def run(self):
            log.info('Checking npm-installation:')
            has_npm = self.has_npm()
            if not has_npm:
                log.error("`npm` unavailable.  If you're running this command "
                          "using sudo, make sure `npm` is availble to sudo")
            if not os.path.exists(self.node_modules):
                log.info('Installing build dependencies with npm.  This may '
                         'take a while...')
                run('npm install', cwd=self.node_package)
            run('npm build', cwd=self.node_package)
    return NPM

packages = []
for d, _, _ in os.walk(pjoin(here, name)):
    if os.path.exists(pjoin(d, '__init__.py')):
        packages.append(d[len(here)+1:].replace(os.path.sep, '.'))

package_data = {
    'nbdime': [
        'tests/files/*.*',
        'webapp/build/*.*',
        'webapp/static/*.*',
        'webapp/templates/*.*',
    ]
}

version_ns = {}
with open(pjoin(here, name, '_version.py')) as f:
    exec(f.read(), {}, version_ns)


setup_args = dict(
    name            = name,
    description     = "Diff and merge of Jupyter Notebooks",
    version         = version_ns['__version__'],
    scripts         = glob(pjoin('scripts', '*')),
    packages        = packages,
    package_data    = package_data,
    author          = 'Jupyter Development Team',
    author_email    = 'jupyter@googlegroups.com',
    url             = 'http://jupyter.org',
    license         = 'BSD',
    platforms       = "Linux, Mac OS X, Windows",
    keywords        = ['Interactive', 'Interpreter', 'Shell', 'Web'],
    classifiers     = [
        'Intended Audience :: Developers',
        'Intended Audience :: System Administrators',
        'Intended Audience :: Science/Research',
        'License :: OSI Approved :: BSD License',
        'Programming Language :: Python',
        'Programming Language :: Python :: 2.7',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
    ],
)

cmdclass = dict(
    build  = js_prerelease(build),
    sdist  = js_prerelease(sdist),
    jsdeps = install_npm(pjoin(here, 'nbdime', 'webapp')),
)

if 'develop' in sys.argv or any(a.startswith('bdist') for a in sys.argv):
    import setuptools
    from setuptools.command.develop import develop

    cmdclass['develop'] = js_prerelease(develop)

setup_args['cmdclass'] = cmdclass

setuptools_args = {}
install_requires = setuptools_args['install_requires'] = [
    'nbformat',
    'six',
    'colorama',
]

extras_require = setuptools_args['extras_require'] = {
    'test': [
        'pytest',
        'testpath',
        'mock',
    ],

    ':python_version == "2.7"': [
        'backports.shutil_which',
    ],
}

if 'setuptools' in sys.modules:
    setup_args.update(setuptools_args)

    # force entrypoints with setuptools (needed for Windows, unconditional because of wheels)
    setup_args['entry_points'] = {
        'console_scripts': [
            'nbdiff = nbdime.nbdiffapp:main',
            'nbdiff-web = nbdime.webapp.nbdiffweb:main',
            'nbpatch = nbdime.nbpatchapp:main',
            'nbmerge = nbdime.nbmergeapp:main',
            'git-nbdifftool = nbdime.gitdifftool:main',
            'git-nbmergetool = nbdime.gitmergetool:main',
            'git-nbdiffdriver = nbdime.gitdiffdriver:main',
            'git-nbmergedriver = nbdime.gitmergedriver:main',
            'git-nbwebdifftool = nbdime.webapp.nbdifftool:main',
            'git-nbwebmergetool = nbdime.webapp.nbmergetool:main',
        ]
    }
    setup_args.pop('scripts', None)

    setup_args.update(setuptools_args)

if __name__ == '__main__':
    setup(**setup_args)
