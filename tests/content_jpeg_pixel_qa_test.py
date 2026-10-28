"""Synthetic JPEG fixtures: tests do not attest live content or providers."""
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from content_jpeg_pixel_qa import (audit_jpeg_sources, read_bounded_local_sources,
    prepare_jpeg_editorial_review_request, read_bounded_review_copy, MAX_SOURCE_BYTES)

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

    def test_visual_near_duplicate_is_advisory_only_with_real_decoded_pixels(self):
        # Same layout, a small pixel change: cryptographic pixels differ, but
        # perceptual similarity should request human visual review.
        base = Image.new("RGB", (32, 32), (120, 120, 120))
        changed = base.copy()
        for y in range(2):
            for x in range(2):
                changed.putpixel((x, y), (220, 20, 20))

        def encode(image):
            stream = io.BytesIO()
            image.save(stream, format="JPEG", quality=95)
            return stream.getvalue()

        sources = [encode(base), encode(changed)]
        result = audit_jpeg_sources(sources, SCOPE, expected_width=32, expected_height=32)
        self.assertNotEqual(result["images"][0]["rgbPixelSha256"],
                            result["images"][1]["rgbPixelSha256"])
        self.assertTrue(result["visualSimilarityReviewRequired"])
        self.assertEqual(len(result["visualSimilarityAdvisories"]), 1)
        self.assertLessEqual(result["visualSimilarityAdvisories"][0]["distance"], 12)
        self.assertEqual(result["status"], "SOURCE_JPEG_PIXEL_QA_ONLY")
        self.assertFalse(result["visualEditorialQaVerified"])
        self.assertFalse(result["independentGenerationVerified"])
        self.assertFalse(result["approvalGranted"])
        self.assertFalse(result["executionAllowed"])
        self.assertEqual(result["qaManifestId"],
                         audit_jpeg_sources(sources, SCOPE, expected_width=32,
                                            expected_height=32)["qaManifestId"])

    def test_distinct_visual_layout_does_not_raise_similarity_advisory(self):
        # Opposite left-to-right luminance gradients should have very different dHashes.
        a = Image.new("RGB", (32, 32))
        b = Image.new("RGB", (32, 32))
        for y in range(32):
            for x in range(32):
                a.putpixel((x, y), (x * 8, x * 8, x * 8))
                b.putpixel((x, y), ((31 - x) * 8,) * 3)
        def encode(image):
            stream = io.BytesIO()
            image.save(stream, format="JPEG", quality=95)
            return stream.getvalue()
        result = audit_jpeg_sources([encode(a), encode(b)], SCOPE,
                                    expected_width=32, expected_height=32)
        self.assertFalse(result["visualSimilarityReviewRequired"])
        self.assertEqual(result["visualSimilarityAdvisories"], [])

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


    def test_jpeg_review_packet_binds_actual_decoded_pixels_and_copy_not_approval(self):
        sources = [jpeg((10, 20, 30)), jpeg((220, 210, 200))]
        copy = {"schemaVersion": 1, "caption": "Dua langkah penjual yang jelas.",
                "altTexts": ["Slaid satu, pelanggan bertanya.", "Slaid dua, penjual menjelaskan."],
                "aiDisclosure": "DECLARED_AI", "claimEvidenceRefs": []}
        def packet(images=sources, scope=SCOPE, content=copy):
            return prepare_jpeg_editorial_review_request(
                images, scope, content, expected_width=4, expected_height=4)
        first = packet()
        self.assertEqual(first["status"], "EDITORIAL_REVIEW_PENDING")
        self.assertTrue(first["sourceBytesDecoded"])
        self.assertTrue(first["distinctDecodedPixelHashes"])
        self.assertEqual(len(first["imageDigests"]), 2)
        self.assertEqual(first["reviewPacketId"], packet()["reviewPacketId"])
        self.assertNotEqual(first["reviewPacketId"], packet(images=sources[::-1])["reviewPacketId"])
        self.assertNotEqual(first["reviewPacketId"], packet(scope={**SCOPE, "tenantId": "tenant-B"})["reviewPacketId"])
        self.assertNotEqual(first["reviewPacketId"], packet(content={**copy, "caption": "Different wording"})["reviewPacketId"])
        for field in ("independentGenerationVerified", "visualEditorialQaVerified",
                      "claimEvidenceVerified", "aiDisclosureVerified", "reviewerAuthenticated",
                      "approvalGranted", "providerCapabilityVerified", "providerSentVerified",
                      "measurementVerified", "learningVerified", "sharedBciAuditVerified",
                      "executionAllowed", "customerSaasReady"):
            self.assertFalse(first[field], field)

    def test_jpeg_review_copy_validation_fails_closed_on_forged_authority(self):
        sources = [jpeg((10, 20, 30)), jpeg((220, 210, 200))]
        copy = {"schemaVersion": 1, "caption": "Jelaskan dahulu.",
                "altTexts": ["Penjual menerangkan langkah pertama.", "Penjual menunjukkan langkah kedua."],
                "aiDisclosure": "DECLARED_AI", "claimEvidenceRefs": []}
        def packet(content):
            return prepare_jpeg_editorial_review_request(
                sources, SCOPE, content, expected_width=4, expected_height=4)
        with self.assertRaisesRegex(ValueError, "INVALID_REVIEW_COPY_FIELDS"):
            packet({**copy, "approvalGranted": True})
        with self.assertRaisesRegex(ValueError, "INVALID_ALT_TEXTS"):
            packet({**copy, "altTexts": ["Only one slide"]})
        with self.assertRaisesRegex(ValueError, "INVALID_CLAIM_REFS"):
            packet({**copy, "claimEvidenceRefs": ["source-1", "source-1"]})
        with self.assertRaisesRegex(ValueError, "INVALID_AI_DISCLOSURE"):
            packet({**copy, "aiDisclosure": "VERIFIED"})
        with self.assertRaisesRegex(ValueError, "INVALID_CAPTION"):
            packet({**copy, "caption": "Bad\ncaption"})

    def test_jpeg_review_similarity_and_claims_remain_pending(self):
        sources = [jpeg((10, 20, 30)), jpeg((220, 210, 200))]
        copy = {"schemaVersion": 1, "caption": "Jelaskan dahulu.",
                "altTexts": ["Tindakan pertama.", "Tindakan kedua."],
                "aiDisclosure": "UNKNOWN", "claimEvidenceRefs": ["source-1"]}
        result = prepare_jpeg_editorial_review_request(
            sources, SCOPE, copy, expected_width=4, expected_height=4)
        self.assertIn("AI_DISCLOSURE_UNRESOLVED", result["automatedReviewFlags"])
        self.assertIn("CLAIM_EVIDENCE_REFERENCES_UNVERIFIED", result["automatedReviewFlags"])
        self.assertFalse(result["approvalGranted"])
        self.assertFalse(result["executionAllowed"])

    def test_bounded_review_copy_file_rejects_duplicate_keys_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "review.json"
            valid.write_text(json.dumps({"schemaVersion": 1, "caption": "Test"}))
            self.assertEqual(read_bounded_review_copy(valid)["caption"], "Test")
            valid.write_text('{"caption":"first","caption":"second"}')
            with self.assertRaisesRegex(ValueError, "DUPLICATE_REVIEW_COPY_KEY"):
                read_bounded_review_copy(valid)
            valid.write_bytes(b" " * 32769)
            with self.assertRaisesRegex(ValueError, "INVALID_REVIEW_COPY_PATH"):
                read_bounded_review_copy(valid)
            link = root / "review-link.json"
            link.symlink_to(valid)
            with self.assertRaisesRegex(ValueError, "INVALID_REVIEW_COPY_PATH"):
                read_bounded_review_copy(link)


if __name__ == "__main__":
    unittest.main()
