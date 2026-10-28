"""Synthetic JPEG fixtures: tests do not attest live content or providers."""
import io
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from content_jpeg_pixel_qa import audit_jpeg_sources, read_bounded_local_sources, MAX_SOURCE_BYTES

SCOPE = {"tenantId": "tenant-A", "instanceId": "internal-pilot", "planId": "plan-001"}


def jpeg(color=(10, 20, 30), *, quality=85, size=(4, 4), exif=None, icc_profile=None):
    image = Image.new("RGB", size, color)
    stream = io.BytesIO()
    kwargs = {"quality": quality}
    if exif is not None:
        kwargs["exif"] = exif
    if icc_profile is not None:
        kwargs["icc_profile"] = icc_profile
    image.save(stream, format="JPEG", **kwargs)
    return stream.getvalue()


def audit(sources, scope=SCOPE):
    return audit_jpeg_sources(sources, scope, expected_width=4, expected_height=4)


class ContentJpegPixelQaTests(unittest.TestCase):
    def test_distinct_real_decoded_pixels_stable_replay_but_not_approval(self):
        sources = [jpeg((10, 20, 30)), jpeg((220, 210, 200))]
        result = audit(sources)
        self.assertEqual(result["status"], "SOURCE_JPEG_PIXEL_QA_ONLY")
        self.assertEqual(len(result["images"]), 2)
        self.assertNotEqual(result["images"][0]["rgbPixelSha256"],
                            result["images"][1]["rgbPixelSha256"])
        self.assertEqual(result["qaManifestId"], audit(sources)["qaManifestId"])
        self.assertNotEqual(result["qaManifestId"], audit(sources[::-1])["qaManifestId"])
        self.assertNotEqual(result["qaManifestId"], audit(sources, {**SCOPE, "tenantId": "tenant-B"})["qaManifestId"])
        for field in ("independentGenerationVerified", "visualEditorialQaVerified",
                      "approvalAuthenticated", "approvalGranted", "providerByteIdentityVerified",
                      "providerSentVerified", "measurementVerified", "learningVerified",
                      "sharedBciAuditVerified", "executionAllowed", "customerSaasReady"):
            self.assertFalse(result[field], field)

    def test_same_file_and_same_decoded_pixels_with_different_jpeg_bytes_rejected(self):
        first = jpeg((40, 50, 60), quality=75)
        with self.assertRaisesRegex(ValueError, "DUPLICATE_SOURCE_BYTES"):
            audit([first, first])
        second = jpeg((40, 50, 60), quality=95)
        self.assertNotEqual(first, second)
        with self.assertRaisesRegex(ValueError, "DUPLICATE_DECODED_PIXELS"):
            audit([first, second])

    def test_corruption_and_mislabeled_bytes_fail_closed(self):
        first = jpeg()
        for invalid in (first[:-2], b"not a jpeg" * 20, b"\x89PNG" + first[4:]):
            with self.assertRaises(ValueError):
                audit([invalid])
        with self.assertRaisesRegex(ValueError, "FORMAT_OR_DIMENSION_MISMATCH"):
            audit([jpeg(size=(5, 4))])
        with self.assertRaisesRegex(ValueError, "INVALID_SOURCE_SET"):
            audit([])

    def test_exif_orientation_and_icc_profile_are_rejected(self):
        exif = Image.Exif()
        exif[274] = 6
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_RENDERING_METADATA"):
            audit([jpeg(exif=exif)])
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_RENDERING_METADATA"):
            audit([jpeg(icc_profile=b"example-profile")])

    def test_cli_preflight_bounds_allocation_and_rejects_nonregular_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "small.jpg"
            valid.write_bytes(b"0" * 64)
            self.assertEqual(read_bounded_local_sources([str(valid)]), [b"0" * 64])
            with self.assertRaisesRegex(ValueError, "INVALID_SOURCE_SET"):
                read_bounded_local_sources([str(valid)] * 21)
            with self.assertRaisesRegex(ValueError, "INVALID_SOURCE_PATH"):
                read_bounded_local_sources([str(root)])
            symlink = root / "symlink.jpg"
            symlink.symlink_to(valid)
            with self.assertRaisesRegex(ValueError, "INVALID_SOURCE_PATH"):
                read_bounded_local_sources([str(symlink)])
            too_large = root / "oversized.jpg"
            with too_large.open("wb") as handle:
                handle.truncate(MAX_SOURCE_BYTES + 1)
            with self.assertRaisesRegex(ValueError, "SOURCE_BYTE_LIMIT"):
                read_bounded_local_sources([str(too_large)])
            # Seven sparse 12 MiB files exceed the 80 MiB aggregate cap.
            sparse_paths = []
            for index in range(7):
                sparse = root / f"sparse-{index}.jpg"
                with sparse.open("wb") as handle:
                    handle.truncate(MAX_SOURCE_BYTES)
                sparse_paths.append(str(sparse))
            with self.assertRaisesRegex(ValueError, "SOURCE_BYTE_LIMIT"):
                read_bounded_local_sources(sparse_paths)

    def test_scope_and_source_type_cannot_be_forged(self):
        with self.assertRaisesRegex(ValueError, "INVALID_SCOPE"):
            audit([jpeg()], {**SCOPE, "approved": True})
        with self.assertRaisesRegex(ValueError, "SOURCE_BYTE_LIMIT"):
            audit([{"sha256": "a" * 64}])
        with self.assertRaisesRegex(ValueError, "INVALID_DIMENSIONS"):
            audit_jpeg_sources([jpeg()], SCOPE, expected_width=True, expected_height=4)


if __name__ == "__main__":
    unittest.main()
