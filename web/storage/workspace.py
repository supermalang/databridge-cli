"""Bridge a project's files (Minio, durable) <-> the local working dirs (a materialized
mirror of the ACTIVE project). Uses the 3a Storage abstraction; keys via storage_key."""
import copy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List

from web.storage.base import storage_key
from web.storage.factory import get_storage
from src.utils.config import write_config
from src.utils.periods import slugify

# Max concurrent object downloads in pull_workspace. The mirror lives on Minio/S3
# over the network, so a project's files are dominated by round-trip latency, not
# bandwidth — downloading them in parallel collapses N sequential round-trips into
# roughly one. The boto3 client and the local backend are both safe to call from
# multiple threads for independent keys/dest paths.
_PULL_WORKERS = 16

# category -> local dir (relative to base)
CATEGORY_DIRS: Dict[str, str] = {
    "processed": "data/processed",
    "reports": "reports",
    "templates": "templates",
}
_CHARTS_SUBDIR = "charts"   # under data/processed; regenerable, never synced


def _local_dir(base: Path, category: str) -> Path:
    return Path(base) / CATEGORY_DIRS[category]


def _local_files(base: Path, category: str) -> List[Path]:
    """Top-level files in a category dir, excluding the processed/charts subdir."""
    d = _local_dir(base, category)
    if not d.is_dir():
        return []
    return [f for f in d.iterdir() if f.is_file()]


def project_files(org_id: str, project_id: str, base=".") -> Dict[str, List[Path]]:
    return {cat: _local_files(Path(base), cat) for cat in CATEGORY_DIRS}


def delete_project_storage(org_id: str, project_id: str) -> None:
    """Remove every durable object under a project's prefix (used when a project is
    deleted). Best-effort: the prefix may not exist if the project never ran."""
    get_storage().delete_prefix(f"orgs/{org_id}/projects/{project_id}/")


def put_project_file(org_id: str, project_id: str, category: str, local_path) -> None:
    """Upload a single file into a project's durable storage under `category`.
    Used for files created outside a run (e.g. a template uploaded via the UI) so
    they're available when a run hydrates that category from Minio into its temp dir."""
    name = Path(local_path).name
    get_storage().put_file(storage_key(org_id, project_id, category, name), local_path)


def delete_project_file(org_id: str, project_id: str, category: str, name: str) -> None:
    """Remove a single file from a project's durable storage. Best-effort."""
    get_storage().delete(storage_key(org_id, project_id, category, name))


def push_outputs(org_id: str, project_id: str, base=".") -> int:
    """Upload the local mirror dirs to Minio under the project prefix. Returns #files."""
    store = get_storage()
    n = 0
    for category, files in project_files(org_id, project_id, base).items():
        for f in files:
            store.put_file(storage_key(org_id, project_id, category, f.name), f)
            n += 1
    return n


def pull_workspace(org_id: str, project_id: str, base=".") -> int:
    """Clear the local mirror dirs (preserving processed/charts) then download the
    project's files from Minio in parallel. Returns #files pulled."""
    store = get_storage()
    tasks: List[tuple] = []   # (key, dest) pairs to download
    for category in CATEGORY_DIRS:
        d = _local_dir(Path(base), category)
        d.mkdir(parents=True, exist_ok=True)
        for f in _local_files(Path(base), category):     # top-level files only; keeps charts/
            f.unlink()
        prefix = storage_key(org_id, project_id, category, "")
        for key in store.list(prefix):
            tasks.append((key, d / key[len(prefix):]))
    if not tasks:
        return 0
    with ThreadPoolExecutor(max_workers=min(_PULL_WORKERS, len(tasks))) as ex:
        # Consume the iterator so every download completes and the first failure
        # (if any) propagates, preserving the original fail-fast behaviour.
        list(ex.map(lambda t: store.get_file(t[0], t[1]), tasks))
    return len(tasks)


def is_empty(org_id: str, project_id: str) -> bool:
    store = get_storage()
    base_prefix = f"orgs/{org_id}/projects/{project_id}/"
    return len(store.list(base_prefix)) == 0


# command -> input categories to hydrate into the run dir (config.yml is always written).
RUN_INPUTS = {
    "download": [],
    "fetch-questions": [],
    "push-prompts": [],
    "generate-template": [],
    "ai-generate-template": [],
    "build-report": ["processed", "templates"],
    "run-all": ["processed", "templates"],
    "suggest-charts": ["processed"],
    "suggest-views": ["processed"],
    "suggest-summaries": ["processed"],
    "suggest-tables": ["processed"],
    "suggest-indicators": ["processed"],
}
_DEFAULT_INPUTS = ["processed", "templates"]   # safe superset for unknown commands


def sanitize_run_config(cfg: dict) -> dict:
    """Return a copy of *cfg* with output locations constrained to the run sandbox.

    Project config is user-editable, but a web run executes in an isolated tempdir
    whose outputs are pushed back to durable storage from the fixed CATEGORY_DIRS.
    An attacker-set ``export.output_dir`` / ``report.output_dir`` (absolute path or
    ``../`` traversal) would write outside that sandbox, and a traversal
    ``form.alias`` would escape via the filename prefix. We pin the output dirs to
    their canonical relative locations (which the push-back step requires anyway)
    and reduce the alias to a filesystem-safe slug. The input dict is not mutated.
    """
    cfg = copy.deepcopy(cfg or {})
    export = cfg.get("export")
    if isinstance(export, dict):
        export["output_dir"] = CATEGORY_DIRS["processed"]
    report = cfg.get("report")
    if isinstance(report, dict):
        report["output_dir"] = CATEGORY_DIRS["reports"]
    form = cfg.get("form")
    if isinstance(form, dict) and form.get("alias"):
        form["alias"] = slugify(str(form["alias"])) or "form"
    return cfg


def hydrate_run_dir(org_id: str, project_id: str, command: str, dest, cfg: dict) -> int:
    """Materialize a run's isolated workspace: write dest/config.yml from cfg, then
    download the command's input categories from Minio into dest. Returns #files pulled."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    write_config(sanitize_run_config(cfg or {}), dest / "config.yml")
    store = get_storage()
    n = 0
    for category in RUN_INPUTS.get(command, _DEFAULT_INPUTS):
        d = dest / CATEGORY_DIRS[category]
        d.mkdir(parents=True, exist_ok=True)
        prefix = storage_key(org_id, project_id, category, "")
        for key in store.list(prefix):
            store.get_file(key, d / key[len(prefix):])
            n += 1
    return n
