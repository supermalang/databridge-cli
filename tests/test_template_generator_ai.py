from unittest import mock
from src.reports import ai_template_generator as atg


def test_template_generator_uses_lf_client(tmp_path):
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
        "charts": [{"name": "c1", "type": "bar"}],
        "questions": [],
    }
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    # Minimal JSON the parser accepts: {"sections": [...]}
    layout_json = '{"sections": []}'
    out = tmp_path / "tpl.docx"

    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value=layout_json) as ch, \
         mock.patch("docx.Document") as mock_doc:
        # Make Document() return a mock that supports all method calls
        mock_doc_instance = mock.MagicMock()
        mock_doc.return_value = mock_doc_instance
        atg.ai_generate_template(cfg, out, "desc", 10, "English")

    assert gp.call_args.args[0] == "template_generator"
    assert ch.call_args.kwargs["trace_name"] == "template_generator"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"description", "pages", "language", "questions_block"} <= set(variables)
