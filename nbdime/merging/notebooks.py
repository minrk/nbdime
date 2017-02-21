# -*- coding: utf-8 -*-

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


import sys
import logging
from six import StringIO

from .generic import decide_merge_with_diff
from .decisions import apply_decisions
from ..diffing.notebooks import diff_notebooks
from ..utils import Strategies
from ..prettyprint import pretty_print_notebook_diff, pretty_print_merge_decisions, pretty_print_notebook

import nbdime.log


# Strategies for handling conflicts
generic_conflict_strategies = (
    "clear",            # Replace value with empty in case of conflict
    "remove",           # Discard value in case of conflict
    "clear-all",        # Discard all values on conflict
    "fail",             # Unexpected: crash and burn in case of conflict (only implemented for leaf nodes)
    "inline-source",    # Valid for source only: produce new source with inline diff markers
    "inline-outputs",   # Valid for outputs only: produce new outputs with inline diff markers
    "mergetool",        # Do not modify decision (but prevent processing at deeper path)
    "record-conflict",  # Valid for metadata only: produce new metadata with conflicts recorded for external inspection
    "take-max",         # Take the maximum value in case of conflict
    "union",            # Join values in case of conflict, don't insert new markers
    "use-base",         # Keep base value in case of conflict
    "use-local",        # Use local value in case of conflict
    "use-remote",       # Use remote value in case of conflict
    )

# Strategies that can be applied to an entire notebook
cli_conflict_strategies = (
    "inline",           # Inline source and outputs, and record metadata conflicts
    "use-base",         # Keep base value in case of conflict
    "use-local",        # Use local value in case of conflict
    "use-remote",       # Use remote value in case of conflict
    #"union",            # Take local value, then remote, in case of conflict
    )

cli_conflict_strategies_input = cli_conflict_strategies

cli_conflict_strategies_output = cli_conflict_strategies + (
    "remove",     # Remove conflicting outputs
    "clear-all",  # Clear all outputs
    )


def notebook_merge_strategies(args):
    strategies = Strategies({
        # These fields should never conflict, that would be an internal error:
        "/nbformat": "fail",
        "/cells/*/cell_type": "fail",
        # Pick highest minor format:
        "/nbformat_minor": "take-max",
        })

    ignore_transients = args.ignore_transients if args else True
    if ignore_transients:
        strategies.transients = [
            "/cells/*/execution_count",
            #"/cells/*/outputs",
            "/cells/*/outputs/*/execution_count",
            "/cells/*/metadata/collapsed",
            "/cells/*/metadata/autoscroll",
            "/cells/*/metadata/scrolled",
        ]
        strategies.update({
            "/cells/*/execution_count": "clear",
            "/cells/*/outputs/*/execution_count": "clear",
        })

    # Get args, default to inline for cli tool, intended to produce
    # an editable notebook that can be manually edited
    merge_strategy = args.merge_strategy if args else "inline"
    input_strategy = args.input_strategy if args else None
    output_strategy = args.output_strategy if args else None

    # Default to merge_strategy
    input_strategy = input_strategy or merge_strategy
    output_strategy = output_strategy or merge_strategy
    metadata_strategy = merge_strategy

    # Set root strategy
    if merge_strategy != 'inline':
        strategies["/"] = merge_strategy

    # Translate 'inline' to specific strategies for different fields
    if input_strategy == 'inline':
        source_strategy = "inline-source"
        attachments_strategy = "inline-attachments"
    else:
        source_strategy = input_strategy
        attachments_strategy = input_strategy

    if output_strategy == 'inline':
        outputs_strategy = "inline-outputs"
    else:
        outputs_strategy = output_strategy

    if metadata_strategy == "inline":
        metadata_strategy = "record-conflict"

    # Set strategies on the main fields
    strategies.update({
        "/metadata": metadata_strategy,
        "/cells/*/metadata": metadata_strategy,
        "/cells/*/outputs/*/metadata": metadata_strategy,
        "/cells/*/source": source_strategy,
        "/cells/*/attachments": attachments_strategy,
        "/cells/*/outputs": outputs_strategy
    })

    return strategies


def decide_notebook_merge(base, local, remote, args=None):
    # Build merge strategies for each document path from arguments
    strategies = notebook_merge_strategies(args)

    # Compute notebook specific diffs
    local_diffs = diff_notebooks(base, local)
    remote_diffs = diff_notebooks(base, remote)

    # Debug outputs
    if args and args.log_level == "DEBUG":
        nbdime.log.debug("In merge, base-local diff:")
        buf = StringIO()
        pretty_print_notebook_diff("<base>", "<local>", base, local_diffs, buf)
        nbdime.log.debug(buf.getvalue())

        nbdime.log.debug("In merge, base-remote diff:")
        buf = StringIO()
        pretty_print_notebook_diff("<base>", "<remote>", base, remote_diffs, buf)
        nbdime.log.debug(buf.getvalue())

    # Execute a generic merge operation
    decisions = decide_merge_with_diff(
        base, local, remote,
        local_diffs, remote_diffs,
        strategies)

    # Debug outputs
    if args and args.log_level == "DEBUG":
        nbdime.log.debug("In merge, decisions:")
        buf = StringIO()
        pretty_print_merge_decisions(base, decisions, buf)
        nbdime.log.debug(buf.getvalue())

    return decisions


def merge_notebooks(base, local, remote, args=None):
    """Merge changes introduced by notebooks local and remote from a shared ancestor base.

    Return new (partially) merged notebook and unapplied diffs from the local and remote side.
    """
    if args and args.log_level == "DEBUG":
        for (name, nb) in [("base", base), ("local", local), ("remote", remote)]:
            nbdime.log.debug("In merge, input %s notebook:", name)
            buf = StringIO()
            pretty_print_notebook(nb, None, buf)
            nbdime.log.debug(buf.getvalue())

    decisions = decide_notebook_merge(base, local, remote, args)

    merged = apply_decisions(base, decisions)

    if args and args.log_level == "DEBUG":
        nbdime.log.debug("In merge, merged notebook:")
        buf = StringIO()
        pretty_print_notebook(merged, None, buf)
        nbdime.log.debug(buf.getvalue())
        nbdime.log.debug("End merge")

    return merged, decisions
