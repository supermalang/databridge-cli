import json, os, subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard-git-flow.sh"


def gitrepo(tmp, branch):
    subprocess.run(["git", "init", "-q", str(tmp)], check=True)
    subprocess.run(["git", "-C", str(tmp), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(tmp), "config", "user.name", "t"], check=True)
    (tmp / "f").write_text("x")
    subprocess.run(["git", "-C", str(tmp), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(tmp), "commit", "-qm", "init"], check=True)
    subprocess.run(["git", "-C", str(tmp), "checkout", "-q", "-B", branch], check=True)
    return tmp


def run(root, command):
    payload = {"tool_name": "Bash", "tool_input": {"command": command}}
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(root))
    return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, env=env)


def test_commit_on_main_blocked(tmp_path):
    p = gitrepo(tmp_path, "main")
    r = run(p, 'git commit -m "x"')
    assert r.returncode == 2 and "main" in r.stderr


def test_push_on_develop_blocked(tmp_path):
    p = gitrepo(tmp_path, "develop")
    assert run(p, "git push origin develop").returncode == 2


def test_commit_on_feature_allowed(tmp_path):
    p = gitrepo(tmp_path, "feature/x")
    assert run(p, 'git commit -m "x"').returncode == 0


def test_plain_push_on_main_blocked(tmp_path):
    p = gitrepo(tmp_path, "main")
    assert run(p, "git push").returncode == 2


def test_non_git_command_ignored(tmp_path):
    p = gitrepo(tmp_path, "main")
    assert run(p, "ls -la").returncode == 0
