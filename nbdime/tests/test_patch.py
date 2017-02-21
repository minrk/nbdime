# coding: utf-8

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.


from nbdime import patch
from nbdime.diff_format import op_patch, op_add, op_remove, op_replace, op_addrange, op_removerange


# TODO: Add tests for invalid input and error handling
# TODO: Add more corner cases (combinations of delete-then-add etc.)


def test_patch_str():
    # Test +, single item insertion
    assert patch("42", [op_patch(0, [op_add(0, "3"), op_remove(1)])]) == "34"

    # Test -, single item deletion
    assert patch("3", [op_patch(0, [op_remove(0)])]) == ""
    assert patch("42", [op_patch(0, [op_remove(0)])]) == "2"
    assert patch("425", [op_patch(0, [op_remove(0)])]) == "25"
    assert patch("425", [op_patch(0, [op_remove(1)])]) == "45"
    assert patch("425", [op_patch(0, [op_remove(2)])]) == "42"

    # Test :, single item replace
    assert patch("52", [op_patch(0, [op_replace(0, "4")])]) == "42"
    assert patch("41", [op_patch(0, [op_replace(1, "2")])]) == "42"
    assert patch("42", [op_patch(0, [op_replace(0, "3"), op_replace(1, "5")])]) == "35"
    assert patch("hello", [op_patch(0, [op_replace(0, "H")])]) == "Hello"
    # Replace by delete-then-insert
    assert patch("world", [op_patch(0, [op_remove(0), op_add(0, "W")])]) == "World"

    # Test !, item patch (doesn't make sense for str)
    pass

    # Test ++, sequence insertion
    assert patch("", [op_patch(0, [op_addrange(0, "34"), op_add(0, "5"), op_addrange(0, "67")])]) == "34567"

    # Test --, sequence deletion
    assert patch("abcd", [op_patch(0, [op_removerange(0, 2)])]) == "cd"
    assert patch("abcd", [op_patch(0, [op_removerange(1, 2)])]) == "ad"
    assert patch("abcd", [op_patch(0, [op_removerange(2, 2)])]) == "ab"


def test_patch_list():
    # Test +, single item insertion
    assert patch([], [op_add(0, 3)]) == [3]
    assert patch([], [op_add(0, 3), op_add(0, 4)]) == [3, 4]
    assert patch([], [op_add(0, 3), op_add(0, 4), op_add(0, 5)]) == [3, 4, 5]

    # Test -, single item deletion
    assert patch([3], [op_remove(0)]) == []
    assert patch([5, 6, 7], [op_remove(0)]) == [6, 7]
    assert patch([5, 6, 7], [op_remove(1)]) == [5, 7]
    assert patch([5, 6, 7], [op_remove(2)]) == [5, 6]
    assert patch([5, 6, 7], [op_remove(0), op_remove(2)]) == [6]

    # Test :, single item replace
    pass

    # Test !, item patch
    assert patch(["hello", "world"], [op_patch(0, [op_patch(0, [op_replace(0, "H")])]),
                                      op_patch(1, [op_patch(0, [op_remove(0), op_add(0, "W")])])]) == ["Hello", "World"]

    # Test ++, sequence insertion
    assert patch([], [op_addrange(0, [3, 4]), op_add(0, 5), op_addrange(0, [6, 7])]) == [3, 4, 5, 6, 7]

    # Test --, sequence deletion
    assert patch([5, 6, 7, 8], [op_removerange(0, 2)]) == [7, 8]
    assert patch([5, 6, 7, 8], [op_removerange(1, 2)]) == [5, 8]
    assert patch([5, 6, 7, 8], [op_removerange(2, 2)]) == [5, 6]


def test_patch_dict():
    # Test +, single item insertion
    assert patch({}, [op_add("d", 4)]) == {"d": 4}
    assert patch({"a": 1}, [op_add("d", 4)]) == {"a": 1, "d": 4}

    #assert patch({"d": 1}, [op_add("d", 4)]) == {"d": 4} # currently triggers assert, raise exception or allow?

    # Test -, single item deletion
    assert patch({"a": 1}, [op_remove("a")]) == {}
    assert patch({"a": 1, "b": 2}, [op_remove("a")]) == {"b": 2}

    # Test :, single item replace
    assert patch({"a": 1, "b": 2}, [op_replace("a", 3)]) == {"a": 3, "b": 2}
    assert patch({"a": 1, "b": 2}, [op_replace("a", 3), op_replace("b", 5)]) == {"a": 3, "b": 5}

    # Test !, item patch
    subdiff = [op_patch(0, [op_patch(0, [op_replace(0, "H")])]), op_patch(1, [op_patch(0, [op_remove(0), op_add(0, "W")])])]
    assert patch({"a": ["hello", "world"], "b": 3}, [op_patch("a", subdiff)]) == {"a": ["Hello", "World"], "b": 3}
