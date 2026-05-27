import re
from unittest import mock
from src.reports import ai_template_generator as atg

# Matches the same pattern lf_client.compile_messages uses — only pure \w+ tokens.
_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def test_template_generator_uses_lf_client(tmp_path, monkeypatch):
    # Ensure Langfuse is disabled so get_prompt takes the seed path and runs
    # compile_messages against the real caller variables.
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
        "charts": [{"name": "c1", "type": "bar"}],
        "questions": [],
    }
    # Minimal JSON the parser accepts: {"sections": [...]}
    layout_json = '{"sections": []}'
    out = tmp_path / "tpl.docx"

    with mock.patch("src.utils.lf_client.chat", return_value=layout_json) as ch, \
         mock.patch("docx.Document") as mock_doc:
        # Make Document() return a mock that supports all method calls
        mock_doc_instance = mock.MagicMock()
        mock_doc.return_value = mock_doc_instance
        # If compile_messages fails (KeyError), this raises before chat is called.
        atg.ai_generate_template(cfg, out, "desc", 10, "English")

    # Verify the trace name is correct
    assert ch.call_args.kwargs["trace_name"] == "template_generator"

    sent = ch.call_args.args[0]

    # The self-mapped literal docxtpl tokens ("period", "n_submissions", "generated_at")
    # survive compilation as {{ period }} etc. — these are intentional and expected.
    # All OTHER pure-word tokens must be resolved. We verify by collecting any remaining
    # _VAR_RE matches and asserting they are ONLY the intentionally-preserved literals.
    PRESERVED_LITERALS = {"period", "n_submissions", "generated_at"}
    for m in sent:
        unresolved = set(_VAR_RE.findall(m["content"]))
        unexpected = unresolved - PRESERVED_LITERALS
        assert not unexpected, (
            f"Message role={m['role']!r} has unresolved {{{{...}}}} tokens: {unexpected}"
        )

    # Verify the literal {{ period }} placeholder is preserved verbatim for the LLM.
    assert any("{{ period }}" in m["content"] for m in sent), \
        "Literal {{ period }} placeholder was not preserved in compiled messages"
