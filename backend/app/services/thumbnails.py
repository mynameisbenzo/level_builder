import base64
import binascii
import re
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from flask import current_app

# What canvas.toDataURL('image/png') (and Phaser's renderer.snapshot(),
# which wraps it - see captureLevelThumbnail.ts) always produces.
# Anything else arriving here isn't a real screenshot the frontend
# generated, so it's rejected outright rather than guessed at.
_DATA_URL_PATTERN = re.compile(r"^data:image/png;base64,(?P<data>.+)$", re.DOTALL)

# A generous ceiling on the decoded image itself - a level's play-mode
# thumbnail is a small, fixed-resolution PNG (see
# captureLevelThumbnail.ts), so anything past a few hundred KB is
# already far outside what a legitimate capture should ever produce.
MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024


class ThumbnailError(Exception):
    """
    Raised for anything wrong with a thumbnail upload - a malformed
    data URL, an oversized image, storage not configured, or the
    actual upload to the bucket failing. Every caller (publish_level)
    catches this: a bad or missing thumbnail is a best-effort loss,
    never something that should block a publish that's otherwise
    valid - see that endpoint's own comment.
    """


def _decode_data_url(data_url: str) -> bytes:
    match = _DATA_URL_PATTERN.match(data_url.strip())
    if not match:
        raise ThumbnailError("thumbnail must be a base64 PNG data URL")

    try:
        image_bytes = base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ThumbnailError("thumbnail data is not valid base64") from exc

    if len(image_bytes) > MAX_THUMBNAIL_BYTES:
        raise ThumbnailError("thumbnail is too large")

    return image_bytes


def storage_configured() -> bool:
    return bool(current_app.config.get("THUMBNAIL_S3_BUCKET"))


def _s3_client():
    config = current_app.config
    kwargs = {
        "aws_access_key_id": config.get("THUMBNAIL_S3_ACCESS_KEY_ID") or None,
        "aws_secret_access_key": config.get("THUMBNAIL_S3_SECRET_ACCESS_KEY") or None,
        "region_name": config.get("THUMBNAIL_S3_REGION") or None,
    }
    endpoint_url = config.get("THUMBNAIL_S3_ENDPOINT_URL")
    if endpoint_url:
        kwargs["endpoint_url"] = endpoint_url
    return boto3.client("s3", **kwargs)


def upload_level_thumbnail(data_url: str, *, level_id: int) -> str:
    """
    Decodes a `data:image/png;base64,...` string and uploads it to
    whichever S3-compatible bucket THUMBNAIL_S3_BUCKET names, returning
    the public URL it's now reachable at.

    One object per level. A published level is final, so there is only
    ever one publish (and so one upload) per level; the random suffix
    just guards against two racing requests ever colliding on the same
    key mid-upload (there's no lock around this call).

    Raises ThumbnailError on any failure. The target bucket is assumed
    to already be configured for public read access (a bucket policy,
    or a CDN in front of it) - this deliberately does NOT pass an ACL
    on the upload itself, since object ACLs are disabled by default on
    modern AWS buckets (and unsupported/ignored by some other
    S3-compatible providers entirely); making the bucket itself public
    is the portable way to do this across providers.
    """
    if not storage_configured():
        raise ThumbnailError("thumbnail storage is not configured")

    image_bytes = _decode_data_url(data_url)

    key = f"level-thumbnails/{level_id}/{uuid.uuid4().hex}.png"

    try:
        client = _s3_client()
        client.put_object(
            Bucket=current_app.config["THUMBNAIL_S3_BUCKET"],
            Key=key,
            Body=image_bytes,
            ContentType="image/png",
        )
    except (BotoCoreError, ClientError) as exc:
        raise ThumbnailError(f"could not upload thumbnail: {exc}") from exc

    public_base_url = current_app.config.get("THUMBNAIL_S3_PUBLIC_BASE_URL") or ""
    if public_base_url:
        return f"{public_base_url.rstrip('/')}/{key}"

    # Fallback for a real AWS S3 bucket with no separate public base
    # URL/CDN configured - the bucket's own regional endpoint. Not
    # correct for every provider (R2 in particular has no equivalent
    # public URL shape of its own), which is exactly why
    # THUMBNAIL_S3_PUBLIC_BASE_URL exists and should be set explicitly
    # for anything other than plain AWS S3.
    region = current_app.config.get("THUMBNAIL_S3_REGION") or "us-east-1"
    bucket = current_app.config["THUMBNAIL_S3_BUCKET"]
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"