import logging
from typing import Dict, List, Optional
import requests

log = logging.getLogger(__name__)
PAGINATION_LIMIT = 100
SUPPORTED_PLATFORMS = ("kobo", "ona")


class DataClient:
    """Base class for Kobo / Ona API clients."""

    def __init__(self, cfg: Dict):
        api = cfg.get("api", {})
        self.platform = api.get("platform", "kobo").lower()
        if self.platform not in SUPPORTED_PLATFORMS:
            raise ValueError(
                f"api.platform must be one of {SUPPORTED_PLATFORMS}, got '{self.platform}'"
            )
        self.base_url = api.get("url", "").rstrip("/")
        self.token = api.get("token", "")
        if not self.base_url or not self.token:
            raise ValueError("api.url and api.token must be set in config.yml")
        self.headers = {"Authorization": f"Token {self.token}"}
        self.form_uid = cfg.get("form", {}).get("uid", "")
        if not self.form_uid:
            raise ValueError("form.uid must be set in config.yml")

    def get_form_schema(self) -> Dict:
        raise NotImplementedError

    def get_submissions(self, sample_size: Optional[int] = None) -> List[Dict]:
        raise NotImplementedError

    def _get(self, endpoint: str, params: Dict = None) -> any:
        url = f"{self.base_url}/{endpoint}"
        resp = requests.get(url, headers=self.headers, params=params or {}, timeout=30)
        resp.raise_for_status()
        return resp.json()


class KoboClient(DataClient):
    """Kobo Toolbox API v2 client."""

    def get_form_schema(self) -> Dict:
        return self._get(f"assets/{self.form_uid}/")

    def get_submissions(self, sample_size: Optional[int] = None) -> List[Dict]:
        results: List[Dict] = []
        params: Dict = {"format": "json", "limit": PAGINATION_LIMIT, "start": 0}
        while True:
            if sample_size:
                remaining = sample_size - len(results)
                if remaining <= 0:
                    break
                params["limit"] = min(PAGINATION_LIMIT, remaining)
            data = self._get(f"assets/{self.form_uid}/data/", params=params)
            batch = data.get("results", [])
            results.extend(batch)
            log.info(f"  fetched {len(results)}/{data.get('count', '?')} submissions")
            if not data.get("next") or not batch:
                break
            params["start"] += len(batch)
        return results


class OnaClient(DataClient):
    """Ona API v1 client."""

    def get_form_schema(self) -> Dict:
        return self._get(f"forms/{self.form_uid}/form.json")

    def get_submissions(self, sample_size: Optional[int] = None) -> List[Dict]:
        results: List[Dict] = []
        page = 1
        while True:
            if sample_size:
                remaining = sample_size - len(results)
                if remaining <= 0:
                    break
                page_size = min(PAGINATION_LIMIT, remaining)
            else:
                page_size = PAGINATION_LIMIT
            params: Dict = {"page": page, "page_size": page_size}
            data = self._get(f"data/{self.form_uid}.json", params=params)
            if isinstance(data, list):
                batch = data
            else:
                batch = data.get("results", data.get("data", []))
            results.extend(batch)
            log.info(f"  fetched {len(results)} submissions")
            if len(batch) < page_size:
                break
            page += 1
        return results


def get_client(cfg: Dict) -> DataClient:
    """Factory: return the right client based on api.platform in config."""
    platform = cfg.get("api", {}).get("platform", "kobo").lower()
    if platform == "ona":
        return OnaClient(cfg)
    return KoboClient(cfg)
