import json, os, subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-branch.sh"


def gitrepo(tmp, branch):
    subprocess.run(["git", "init", "-q", str(tmp)], check=True)
    subprocess.run(["git", "-C", str(tmp), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(tmp), "config", "user.name", "t"], check=True)
    (tmp / "f").write_text("x")
    subprocess.run(["git", "-C", str(tmp), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(tmp), "commit", "-qm", "init"], check=True)
    subprocess.run(["git", "-C", str(tmp), "checkout", "-q", "-B", branch], check=True)
    return tmp


def run(root, fp):
    payload = {"tool_name": "Write", "tool_input": {"file_path": fp, "content": "c"}}
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, env=env)


def test_code_edit_on_main_blocked(tmp_path):
    p = gitrepo(tmp_path, "main")
    r = run(p, str(tmp_path / "src" / "x.py"))
    assert r.returncode == 2 and "main" in r.stderr


def test_code_edit_on_develop_blocked(tmp_path):
    p = gitrepo(tmp_path, "develop")
    assert run(p, str(tmp_path / "src" / "x.py")).returncode == 2


def test_code_edit_on_feature_allowed(tmp_path):
    p = gitrepo(tmp_path, "feature/x")
    assert run(p, str(tmp_path / "src" / "x.py")).returncode == 0


def test_docs_edit_on_main_allowed(tmp_path):
    p = gitrepo(tmp_path, "main")
    assert run(p, str(tmp_path / "docs" / "x.md")).returncode == 0
