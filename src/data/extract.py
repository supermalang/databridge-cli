import logging
from typing import Dict, List, Optional
import requests

log = logging.getLogger(__name__)
PAGINATION_LIMIT = 100

class KoboClient:
    def __init__(self, cfg: Dict):
        api = cfg.get("api", {})
        self.base_url = api.get("url", "").rstrip("/")
        self.token = api.get("token", "")
        if not self.base_url or not self.token:
            raise ValueError("api.url and api.token must be set in config.yml")
        self.headers = {"Authorization": f"Token {self.token}"}
        self.form_uid = cfg.get("form", {}).get("uid", "")
        if not self.form_uid:
            raise ValueError("form.uid must be set in config.yml")

    def get_form_schema(self) -> Dict:
        return self._get(f"assets/{self.form_uid}/")

    def get_submissions(self, sample_size: Optional[int] = None) -> List[Dict]:
        results: List[Dict] = []
        params: Dict = {"format": "json", "limit": PAGINATION_LIMIT, "start": 0}
        while True:
            if sample_size:
                remaining = sample_size - len(results)
                if remaining <= 0: break
                params["limit"] = min(PAGINATION_LIMIT, remaining)
            data = self._get(f"assets/{self.form_uid}/data/", params=params)
            batch = data.get("results", [])
            results.extend(batch)
            log.info(f"  fetched {len(results)}/{data.get('count','?')} submissions")
            if not data.get("next") or not batch: break
            params["start"] += len(batch)
        return results

    def _get(self, endpoint: str, params: Dict = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        resp = requests.get(url, headers=self.headers, params=params or {}, timeout=30)
        resp.raise_for_status()
        return resp.json()
