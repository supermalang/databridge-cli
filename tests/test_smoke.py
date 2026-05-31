def test_api_status_returns_200(api_client):
    r = api_client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert "status" in body
