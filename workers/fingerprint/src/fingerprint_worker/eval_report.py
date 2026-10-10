"""Turns signal matrices into the phase 3 report: one operating point per rule at the precision
floor, per-transform recall, a threshold sweep CSV and a precision/recall chart."""

from pathlib import Path

import numpy as np

from fingerprint_worker.eval_rules import (
    RULE_BY_NAME, OperatingPointDetails, best_matches, pick_operating_point, recall_by_group, score_at_threshold, sweep_thresholds,
)

THRESHOLD_LIST = [round(value, 2) for value in np.arange(0.50, 1.0, 0.01)]
CURRENT_REVIEW_THRESHOLD = 0.80


def evaluate_rules(signal_matrices: dict, truth_index: np.ndarray, transform_labels: np.ndarray, min_precision: float) -> dict:
    rule_results = {}
    for rule_name, rule in RULE_BY_NAME.items():
        confidence_matrix = rule(signal_matrices["pdq_distance"], signal_matrices["pdq_dihedral_distance"], signal_matrices["clip_similarity"])
        best_index, best_confidence = best_matches(confidence_matrix)
        sweep_list = sweep_thresholds(best_index, best_confidence, truth_index, THRESHOLD_LIST)
        operating_point = pick_operating_point(sweep_list, min_precision)
        chosen_threshold = operating_point.threshold if operating_point else CURRENT_REVIEW_THRESHOLD
        rule_results[rule_name] = {
            "sweep": sweep_list,
            "operating_point": operating_point,
            "at_current_threshold": score_at_threshold(best_index, best_confidence, truth_index, CURRENT_REVIEW_THRESHOLD),
            "recall_by_transform": recall_by_group(best_index, best_confidence, truth_index, transform_labels, chosen_threshold),
        }
    return rule_results


def _format_point(operating_point: OperatingPointDetails | None) -> str:
    if operating_point is None:
        return "— | — | — | —"
    return f"{operating_point.threshold:.2f} | {operating_point.precision:.3f} | {operating_point.recall:.3f} | {operating_point.false_positive_count}"


def render_markdown(rule_results: dict, dataset_summary: dict, min_precision: float) -> str:
    report_lines = [
        "# Phase 3 evaluation",
        "",
        f"{dataset_summary['original_count']} originals × 8 transforms = {dataset_summary['positive_count']} positive probes; "
        f"{dataset_summary['negative_count']} same-theme negatives. Precision floor {min_precision}.",
        "",
        f"| Rule | Threshold at P ≥ {min_precision} | Precision | Recall | False positives | Recall at {CURRENT_REVIEW_THRESHOLD} (P) |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for rule_name, rule_result in rule_results.items():
        current_point = rule_result["at_current_threshold"]
        report_lines.append(f"| {rule_name} | {_format_point(rule_result['operating_point'])} | "
                            f"{current_point.recall:.3f} ({current_point.precision:.3f}) |")
    transform_names = sorted(next(iter(rule_results.values()))["recall_by_transform"])
    report_lines += ["", "Recall per transform at each rule's operating point:", "",
                     "| Rule | " + " | ".join(transform_names) + " |", "| --- |" + " --- |" * len(transform_names)]
    for rule_name, rule_result in rule_results.items():
        recall_cells = " | ".join(f"{rule_result['recall_by_transform'][name]:.2f}" for name in transform_names)
        report_lines.append(f"| {rule_name} | {recall_cells} |")
    return "\n".join(report_lines) + "\n"


def write_sweep_csv(rule_results: dict, sweep_path: Path) -> None:
    csv_lines = ["rule,threshold,precision,recall,true_positives,false_positives"]
    for rule_name, rule_result in rule_results.items():
        csv_lines += [f"{rule_name},{point.threshold},{point.precision:.4f},{point.recall:.4f},{point.true_positive_count},{point.false_positive_count}"
                      for point in rule_result["sweep"]]
    sweep_path.write_text("\n".join(csv_lines) + "\n", encoding="utf-8")


def write_chart(rule_results: dict, chart_path: Path, min_precision: float) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, axes = plt.subplots(figsize=(7, 5), dpi=120)
    for rule_name, rule_result in rule_results.items():
        axes.plot([point.recall for point in rule_result["sweep"]], [point.precision for point in rule_result["sweep"]], label=rule_name)
    axes.axhline(min_precision, color="grey", linestyle="--", linewidth=1, label=f"precision floor {min_precision}")
    axes.set_xlabel("Recall")
    axes.set_ylabel("Precision")
    axes.set_title("Precision vs recall, thresholds 0.50–0.99")
    axes.set_ylim(0.5, 1.01)
    axes.legend(loc="lower left")
    figure.tight_layout()
    figure.savefig(chart_path)
    plt.close(figure)
