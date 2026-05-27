import pytest
from src.utils import lf_client


def test_compile_substitutes_variables():
    msgs = [{"role": "user", "content": "Hello {{name}}, {{n}} rows"}]
    out = lf_client.compile_messages(msgs, {"name": "World", "n": 5})
    assert out == [{"role": "user", "content": "Hello World, 5 rows"}]


def test_compile_missing_variable_raises_keyerror():
    msgs = [{"role": "user", "content": "Hello {{name}}"}]
    with pytest.raises(KeyError) as exc:
        lf_client.compile_messages(msgs, {})
    assert "name" in str(exc.value)


def test_compile_leaves_literal_json_braces_untouched():
    msgs = [{"role": "user", "content": 'Return {"k": "v"} for {{who}}'}]
    out = lf_client.compile_messages(msgs, {"who": "me"})
    assert out[0]["content"] == 'Return {"k": "v"} for me'


def test_compile_handles_whitespace_in_braces():
    msgs = [{"role": "user", "content": "{{ name }}"}]
    out = lf_client.compile_messages(msgs, {"name": "X"})
    assert out[0]["content"] == "X"
