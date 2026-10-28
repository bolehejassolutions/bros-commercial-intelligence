"""Offline BROS CONTENT JPEG decoded-pixel QA. Not generation or publishing proof.

Pillow is required. Caller supplies raw bytes and unauthenticated scope; this module
never fetches providers, approves content, or writes shared BCI/Neon data.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import os
import re
import stat

from PIL import Image, ImageFile, UnidentifiedImageError, __version__ as PILLOW_VERSION

ImageFile.LOAD_TRUNCATED_IMAGES = False
MAX_SOURCE_BYTES = 12 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024
MAX_PIXELS = 12_000_000
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$")


def _fail(code):
    raise ValueError("CONTENT_JPEG_QA_" + code)


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def audit_jpeg_sources(sources, scope, *, expected_width=1080, expected_height=1350):
    """Return deterministic, non-authoritative QA for 1..20 raw JPEG byte streams."""
    if (not isinstance(scope, dict) or set(scope) != {"tenantId", "instanceId", "planId"}
            or any(not isinstance(v, str) or not ID.fullmatch(v) for v in scope.values())):
        _fail("INVALID_SCOPE")
    if (not isinstance(expected_width, int) or isinstance(expected_width, bool)
            or not isinstance(expected_height, int) or isinstance(expected_height, bool)
            or expected_width < 1 or expected_height < 1
            or expected_width * expected_height > MAX_PIXELS):
        _fail("INVALID_DIMENSIONS")
    if not isinstance(sources, (list, tuple)) or not 1 <= len(sources) <= 20:
        _fail("INVALID_SOURCE_SET")
    if any(not isinstance(data, bytes) or not 64 <= len(data) <= MAX_SOURCE_BYTES
           for data in sources) or sum(map(len, sources)) > MAX_TOTAL_BYTES:
        _fail("SOURCE_BYTE_LIMIT")

    images = []
    for slot, data in enumerate(sources, start=1):
        if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            _fail("INVALID_JPEG_BOUNDARY")
        try:
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format != "JPEG" or probe.size != (expected_width, expected_height):
                    _fail("FORMAT_OR_DIMENSION_MISMATCH")
                if probe.width * probe.height > MAX_PIXELS:
                    _fail("PIXEL_LIMIT")
                if probe.mode != "RGB" or probe.info.get("icc_profile") or probe.getexif().get(274, 1) != 1:
                    _fail("UNSUPPORTED_RENDERING_METADATA")
                probe.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                decoded.load()  # Full DCT decode, unlike JPEG marker-only validation.
                if decoded.mode != "RGB" or decoded.size != (expected_width, expected_height):
                    _fail("DECODED_FORMAT_MISMATCH")
                pixel_digest = _digest(
                    b"RGB\0" + expected_width.to_bytes(4, "big")
                    + expected_height.to_bytes(4, "big") + decoded.tobytes()
                )
                # Perceptual dHash is a similarity REVIEW cue, not image-independence proof.
                # A sequential carousel may intentionally reuse a scene; never auto-reject it.
                gray = decoded.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
                dhash_bits = 0
                for row in range(8):
                    for col in range(8):
                        dhash_bits = (dhash_bits << 1) | int(
                            gray.getpixel((col, row)) > gray.getpixel((col + 1, row))
                        )
        except (OSError, SyntaxError, UnidentifiedImageError) as exc:
            raise ValueError("CONTENT_JPEG_QA_DECODE_FAILED") from exc
        images.append({"slot": slot, "format": "JPEG", "width": expected_width,
                       "height": expected_height, "bytes": len(data),
                       "sha256": _digest(data), "rgbPixelSha256": pixel_digest,
                       "perceptualDHash64": f"{dhash_bits:016x}"})

    if len({image["sha256"] for image in images}) != len(images):
        _fail("DUPLICATE_SOURCE_BYTES")
    if len({image["rgbPixelSha256"] for image in images}) != len(images):
        _fail("DUPLICATE_DECODED_PIXELS")
    # Review only: perceptual similarity is not a cryptographic duplicate.
    # Threshold 12/64 is a heuristic, not an editorial or provider guarantee.
    advisories = []
    for i, first in enumerate(images):
        for second in images[i + 1:]:
            distance = (int(first["perceptualDHash64"], 16)
                        ^ int(second["perceptualDHash64"], 16)).bit_count()
            if distance <= 12:
                advisories.append({"slotA": first["slot"], "slotB": second["slot"],
                                   "distance": distance, "bits": 64,
                                   "reason": "POSSIBLE_VISUAL_NEAR_DUPLICATE_REVIEW"})
    identity = [1, scope["tenantId"], scope["instanceId"], scope["planId"],
                [[x["slot"], x["sha256"], x["rgbPixelSha256"]] for x in images]]
    manifest_id = "content-jpeg-pixel-" + _digest(json.dumps(identity, separators=(",", ":")).encode())
    return {"schemaVersion": 1, "product": "content", **scope,
            "qaManifestId": manifest_id, "status": "SOURCE_JPEG_PIXEL_QA_ONLY",
            "decoder": "Pillow", "decoderVersion": PILLOW_VERSION,
            "images": images, "sourceBytesDecoded": True, "distinctFileHashes": True,
            "distinctDecodedPixelHashes": True,
            "visualSimilarityHeuristic": "DHASH64_HAMMING_LE_12_ADVISORY_ONLY",
            "visualSimilarityReviewRequired": bool(advisories),
            "visualSimilarityAdvisories": advisories,
            "independentGenerationVerified": False,
            "visualEditorialQaVerified": False, "approvalAuthenticated": False,
            "approvalGranted": False, "providerByteIdentityVerified": False,
            "providerSentVerified": False, "measurementVerified": False,
            "learningVerified": False, "sharedBciAuditVerified": False,
            "executionAllowed": False, "customerSaasReady": False}


def read_bounded_local_sources(file_names):
    """Bound local CLI reads before allocation; never treat this as provider attestation."""
    if not isinstance(file_names, (list, tuple)) or not 1 <= len(file_names) <= 20:
        _fail("INVALID_SOURCE_SET")
    paths = [Path(name) for name in file_names]
    estimated_total = 0
    for path in paths:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            _fail("INVALID_SOURCE_PATH")
        if not 64 <= info.st_size <= MAX_SOURCE_BYTES:
            _fail("SOURCE_BYTE_LIMIT")
        estimated_total += info.st_size
        if estimated_total > MAX_TOTAL_BYTES:
            _fail("SOURCE_BYTE_LIMIT")
    # Recheck after opening: a file can change between lstat and the read.
    sources = []
    actual_total = 0
    for path in paths:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or not 64 <= info.st_size <= MAX_SOURCE_BYTES:
                _fail("SOURCE_BYTE_LIMIT")
            data = handle.read(MAX_SOURCE_BYTES + 1)
        actual_total += len(data)
        if not 64 <= len(data) <= MAX_SOURCE_BYTES or actual_total > MAX_TOTAL_BYTES:
            _fail("SOURCE_BYTE_LIMIT")
        sources.append(data)
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1350)
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()
    try:
        result = audit_jpeg_sources(read_bounded_local_sources(args.files),
                                    {"tenantId": args.tenant_id, "instanceId": args.instance_id,
                                     "planId": args.plan_id},
                                    expected_width=args.width, expected_height=args.height)
    except (ValueError, OSError) as exc:
        parser.exit(2, f"QA failed: {exc}\n")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
