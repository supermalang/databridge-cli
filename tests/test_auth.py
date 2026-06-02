import time
import pytest
from web import auth


def test_session_codec_roundtrip():
    codec = auth.SessionCodec("a-very-secret-key")
    token = codec.encode({"sub": "u1", "email": "u1@x.io"})
    assert isinstance(token, str)
    out = codec.decode(token)
    assert out["sub"] == "u1"
    assert out["email"] == "u1@x.io"


def test_session_codec_rejects_tampered():
    codec = auth.SessionCodec("a-very-secret-key")
    token = codec.encode({"sub": "u1"})
    assert codec.decode(token[:-2] + "xy") is None


def test_session_codec_rejects_wrong_key():
    token = auth.SessionCodec("key-one").encode({"sub": "u1"})
    assert auth.SessionCodec("key-two").decode(token) is None
