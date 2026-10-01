import base64

import pytest
from botocore.exceptions import ClientError

from app.main import create_app
from app.services.thumbnails import ThumbnailError, storage_configured, upload_level_thumbnail

VALID_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(b"not a real png, just bytes").decode()


class _FakeS3Client:
    """Records every put_object call instead of making a real network
    request - what every test below inspects instead of hitting an
    actual bucket."""

    def __init__(self):
        self.put_object_calls = []

    def put_object(self, **kwargs):
        self.put_object_calls.append(kwargs)


def _app_with_storage_configured():
    app = create_app("testing")
    app.config["THUMBNAIL_S3_BUCKET"] = "test-bucket"
    app.config["THUMBNAIL_S3_REGION"] = "us-east-1"
    app.config["THUMBNAIL_S3_PUBLIC_BASE_URL"] = "https://cdn.example.com"
    return app


def test_storage_configured_is_false_with_no_bucket_set():
    app = create_app("testing")
    with app.app_context():
        assert app.config["THUMBNAIL_S3_BUCKET"] == ""
        assert storage_configured() is False


def test_storage_configured_is_true_once_a_bucket_is_set():
    app = _app_with_storage_configured()
    with app.app_context():
        assert storage_configured() is True


def test_upload_rejects_a_non_data_url_string():
    app = _app_with_storage_configured()
    with app.app_context():
        with pytest.raises(ThumbnailError):
            upload_level_thumbnail("not-a-data-url", level_id=1, version_number=1)


def test_upload_rejects_a_data_url_with_the_wrong_mime_type():
    app = _app_with_storage_configured()
    with app.app_context():
        with pytest.raises(ThumbnailError):
            upload_level_thumbnail(
                "data:image/jpeg;base64," + base64.b64encode(b"jpeg bytes").decode(),
                level_id=1,
                version_number=1,
            )


def test_upload_rejects_invalid_base64():
    app = _app_with_storage_configured()
    with app.app_context():
        with pytest.raises(ThumbnailError):
            upload_level_thumbnail("data:image/png;base64,not-valid-base64!!!", level_id=1, version_number=1)


def test_upload_rejects_an_oversized_image():
    app = _app_with_storage_configured()
    with app.app_context():
        oversized = base64.b64encode(b"x" * (3 * 1024 * 1024)).decode()
        with pytest.raises(ThumbnailError):
            upload_level_thumbnail(f"data:image/png;base64,{oversized}", level_id=1, version_number=1)


def test_upload_raises_when_storage_is_not_configured():
    app = create_app("testing")
    with app.app_context():
        with pytest.raises(ThumbnailError):
            upload_level_thumbnail(VALID_PNG_DATA_URL, level_id=1, version_number=1)


def test_upload_puts_the_decoded_bytes_to_the_configured_bucket_and_key(monkeypatch):
    app = _app_with_storage_configured()
    with app.app_context():
        fake_client = _FakeS3Client()
        monkeypatch.setattr("app.services.thumbnails.boto3.client", lambda *a, **kw: fake_client)

        url = upload_level_thumbnail(VALID_PNG_DATA_URL, level_id=42, version_number=3)

        assert len(fake_client.put_object_calls) == 1
        call = fake_client.put_object_calls[0]
        assert call["Bucket"] == "test-bucket"
        assert call["ContentType"] == "image/png"
        assert call["Body"] == b"not a real png, just bytes"
        # Keyed by level id and version number, plus a random suffix -
        # both must actually appear in the key, but the whole key isn't
        # predictable up front.
        assert call["Key"].startswith("level-thumbnails/42/v3-")
        assert call["Key"].endswith(".png")

        # And the returned URL is built from THUMBNAIL_S3_PUBLIC_BASE_URL,
        # not guessed from the bucket/region.
        assert url == f"https://cdn.example.com/{call['Key']}"


def test_upload_falls_back_to_a_plain_s3_url_with_no_public_base_url_configured(monkeypatch):
    app = create_app("testing")
    app.config["THUMBNAIL_S3_BUCKET"] = "another-bucket"
    app.config["THUMBNAIL_S3_REGION"] = "us-west-2"
    with app.app_context():
        fake_client = _FakeS3Client()
        monkeypatch.setattr("app.services.thumbnails.boto3.client", lambda *a, **kw: fake_client)

        url = upload_level_thumbnail(VALID_PNG_DATA_URL, level_id=7, version_number=1)

        key = fake_client.put_object_calls[0]["Key"]
        assert url == f"https://another-bucket.s3.us-west-2.amazonaws.com/{key}"


def test_upload_wraps_a_boto_client_error_as_a_thumbnail_error(monkeypatch):
    app = _app_with_storage_configured()
    with app.app_context():
        class _FailingClient:
            def put_object(self, **kwargs):
                raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "PutObject")

        monkeypatch.setattr("app.services.thumbnails.boto3.client", lambda *a, **kw: _FailingClient())

        with pytest.raises(ThumbnailError):
            upload_level_thumbnail(VALID_PNG_DATA_URL, level_id=1, version_number=1)