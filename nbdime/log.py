# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


import logging


class NBDiffFormatError(ValueError):
    pass


def init_logging(level=logging.INFO):
    """Sets up logging for nbdime entry points.

    Call this in all entry points (if __name__ == "__main__").
    Sets the log level for all nbdime loggers to `level`,
    unless `level` is given as `None`.
    """
    format = '[%(levelname)1.1s %(module)s:%(lineno)d] %(message)s'
    logging.basicConfig(format=format, level=level)
    logging.captureWarnings(True)


def set_nbdime_log_level(level, set_main=True):
    """Set a log level for nbdime loggers"""
    logger.setLevel(level)
    if set_main:
        _baseLogger = logging.getLogger()
        _baseLogger.setLevel(level)


logger = logging.getLogger('nbdime')

debug = logger.debug
info = logger.info
warning = logger.warning
error = logger.error
exception = logger.exception
critical = logger.critical
