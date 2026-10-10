"""`make eval`: download the CC0 set, fingerprint every probe with the production code, compare
scoring rules, and write eval/results/{report.md, sweep.csv, pr_curve.png, labels.csv}.

  python -m fingerprint_worker.eval_run --data ../../eval/data --out ../../eval/results
  python -m fingerprint_worker.eval_run --limit-originals 20 --limit-negatives 200   # quick run
"""

import argparse
import logging
import sys
from pathlib import Path

import numpy as np

from fingerprint_worker.eval_dataset import build_probes, download_images, load_manifest, write_labels
from fingerprint_worker.eval_report import evaluate_rules, render_markdown, write_chart, write_sweep_csv
from fingerprint_worker.eval_rules import NEGATIVE_TRUTH, assign_split
from fingerprint_worker.eval_signals import build_signal_matrices, fingerprint_originals, fingerprint_probes, load_or_compute
from fingerprint_worker.fingerprinting import Fingerprinter

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MIN_PRECISION = 0.95
DEFAULT_MIN_RECALL = 0.90


def parse_arguments() -> argparse.Namespace:
    argument_parser = argparse.ArgumentParser(prog="fingerprint_worker.eval_run")
    argument_parser.add_argument("--manifest", type=Path, default=REPO_ROOT / "eval" / "manifest.json")
    argument_parser.add_argument("--data", type=Path, default=REPO_ROOT / "eval" / "data")
    argument_parser.add_argument("--out", type=Path, default=REPO_ROOT / "eval" / "results")
    argument_parser.add_argument("--limit-originals", type=int, default=None)
    argument_parser.add_argument("--limit-negatives", type=int, default=None)
    argument_parser.add_argument("--min-precision", type=float, default=DEFAULT_MIN_PRECISION)
    argument_parser.add_argument("--min-recall", type=float, default=DEFAULT_MIN_RECALL)
    return argument_parser.parse_args()


def build_truth(probe_list, original_id_list) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Ground-truth original per probe, its transform, and its held-out split (copies follow their original)."""
    original_index_by_id = {eval_id: index for index, eval_id in enumerate(original_id_list)}
    truth_index = np.array([original_index_by_id[probe.truth_eval_id] if probe.truth_eval_id else NEGATIVE_TRUTH for probe in probe_list])
    split_labels = np.array([assign_split(probe.source_eval_id) for probe in probe_list])
    return truth_index, np.array([probe.transform for probe in probe_list]), split_labels


def run_evaluation(parsed_arguments: argparse.Namespace) -> dict:
    logging.info("Step 1: loading manifest and downloading images")
    original_list, negative_list = load_manifest(parsed_arguments.manifest, parsed_arguments.data / "images",
                                                 parsed_arguments.limit_originals, parsed_arguments.limit_negatives)
    original_list, negative_list = download_images(original_list), download_images(negative_list)
    probe_list = build_probes(original_list, negative_list)
    write_labels(probe_list, parsed_arguments.out / "labels.csv")

    logging.info("Step 2: fingerprinting %d originals and %d probes", len(original_list), len(probe_list))
    fingerprinter = Fingerprinter()
    image_path_by_id = {image.eval_id: image.image_path for image in original_list + negative_list}
    original_arrays = load_or_compute(parsed_arguments.data / "fp_originals.npz", [image.eval_id for image in original_list],
                                      lambda: fingerprint_originals(fingerprinter, original_list))
    probe_arrays = load_or_compute(parsed_arguments.data / "fp_probes.npz", [probe.probe_id for probe in probe_list],
                                   lambda: fingerprint_probes(fingerprinter, probe_list, image_path_by_id))

    logging.info("Step 3: scoring rules")
    truth_index, transform_labels, split_labels = build_truth(probe_list, original_arrays["ids"].tolist())
    rule_results = evaluate_rules(build_signal_matrices(probe_arrays, original_arrays), truth_index, transform_labels,
                                  parsed_arguments.min_precision, split_labels)
    dataset_summary = {"original_count": len(original_list), "positive_count": int((truth_index != NEGATIVE_TRUTH).sum()),
                       "negative_count": len(negative_list)}
    return {"rule_results": rule_results, "dataset_summary": dataset_summary}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    parsed_arguments = parse_arguments()
    evaluation_details = run_evaluation(parsed_arguments)
    rule_results = evaluation_details["rule_results"]
    parsed_arguments.out.mkdir(parents=True, exist_ok=True)
    report_markdown = render_markdown(rule_results, evaluation_details["dataset_summary"], parsed_arguments.min_precision)
    (parsed_arguments.out / "report.md").write_text(report_markdown, encoding="utf-8")
    write_sweep_csv(rule_results, parsed_arguments.out / "sweep.csv")
    write_chart(rule_results, parsed_arguments.out / "pr_curve.png", parsed_arguments.min_precision)
    print(report_markdown)

    passing_rule_list = [name for name, result in rule_results.items()
                         if result["operating_point"] and result["operating_point"].recall >= parsed_arguments.min_recall]
    print(f"Rules meeting P >= {parsed_arguments.min_precision} and R >= {parsed_arguments.min_recall}: {passing_rule_list or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
