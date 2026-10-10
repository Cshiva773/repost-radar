from pathlib import Path

import numpy as np

from fingerprint_worker.eval_dataset import EvalImageDetails, build_probes, write_labels
from fingerprint_worker.eval_report import evaluate_rules, render_markdown
from fingerprint_worker.eval_rules import NEGATIVE_TRUTH
from fingerprint_worker.eval_signals import hamming_matrix


def test_build_probes_makes_eight_positives_per_original_plus_negatives(tmp_path: Path):
    original_list = [EvalImageDetails("orig-001", "dog", "u", tmp_path / "a.jpg")]
    negative_list = [EvalImageDetails("neg-0001", "dog", "u", tmp_path / "b.jpg")]
    probe_list = build_probes(original_list, negative_list)
    assert len(probe_list) == 9
    assert probe_list[-1].transform == "negative" and probe_list[-1].truth_eval_id is None
    write_labels(probe_list, tmp_path / "labels.csv")
    assert (tmp_path / "labels.csv").read_text(encoding="utf-8").count("\n") == 10


def test_hamming_matrix_counts_differing_bits():
    probe_pdq = np.array([[0b11110000, 0], [0, 0]], dtype=np.uint8)
    original_pdq = np.array([[0, 0], [0b11110000, 0b00000001]], dtype=np.uint8)
    assert hamming_matrix(probe_pdq, original_pdq).tolist() == [[4, 1], [0, 5]]


def test_evaluate_rules_and_render_on_synthetic_signals():
    # 2 originals; probes: a near-copy and a flip of orig 0, and one same-theme negative
    signal_matrices = {
        "pdq_distance": np.array([[4, 120], [126, 118], [125, 124]]),
        "pdq_dihedral_distance": np.array([[4, 120], [6, 118], [125, 124]]),
        "clip_similarity": np.array([[0.97, 0.30], [0.975, 0.30], [0.62, 0.55]], dtype=np.float32),
    }
    truth_index = np.array([0, 0, NEGATIVE_TRUTH])
    transform_labels = np.array(["resize_50", "flip_h", "negative"])
    rule_results = evaluate_rules(signal_matrices, truth_index, transform_labels, min_precision=0.95)

    assert rule_results["blend_v1"]["at_current_threshold"].recall == 0.5      # the flip is missed at 0.80
    assert rule_results["clip_led"]["at_current_threshold"].recall == 1.0      # CLIP-led catches it
    assert rule_results["clip_led"]["at_current_threshold"].false_positive_count == 0

    report_markdown = render_markdown(rule_results, {"original_count": 2, "positive_count": 2, "negative_count": 1}, 0.95)
    assert "| clip_led |" in report_markdown and "flip_h" in report_markdown
