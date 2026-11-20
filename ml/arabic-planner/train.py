"""Fine-tune a closed-set Arabic intent classifier; large training artifacts stay outside Git."""

import argparse, hashlib, json, random
from pathlib import Path
import numpy as np
import torch
from torch import nn
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    BertConfig,
    BertForSequenceClassification,
)

ROOT = Path(__file__).resolve().parent


def load_rows(path):
    return [
        json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()
    ]


def prepare_inputs(tokenizer, rows, max_tokens):
    # Never silently truncate: omitted exclusions or ayah constraints change meaning.
    kept = []
    skipped = 0
    for row in rows:
        text = row.get("model_input")
        if text is None:
            skipped += 1
            continue
        if len(tokenizer(text, truncation=False)["input_ids"]) > max_tokens:
            skipped += 1
            continue
        kept.append(row)
    return kept, skipped


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--data-dir", type=Path, default=ROOT / "data")
    p.add_argument("--epochs", type=int, default=8)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--lr", type=float, default=2e-5)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max-steps", type=int)
    p.add_argument("--smoke", action="store_true")
    p.add_argument("--initialize-from", type=Path)
    p.add_argument("--deduplicate-inputs", action="store_true")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = p.parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(min(torch.get_num_threads(), 8))
    spec = json.loads((ROOT / "model.json").read_text())
    catalog = json.loads((ROOT / "catalog.json").read_text())
    labels = [entry["id"] for entry in catalog["intents"]]
    label2id = {label: i for i, label in enumerate(labels)}
    args.output.mkdir(parents=True, exist_ok=True)
    train = load_rows(args.data_dir / "train.jsonl")
    validation = load_rows(args.data_dir / "validation.jsonl")
    if set(row["request"] for row in train) & set(row["request"] for row in validation):
        raise ValueError("Training/validation request leakage.")
    if set(row["family_id"] for row in train) & set(
        row["family_id"] for row in validation
    ):
        raise ValueError("Training/validation template-family leakage.")
    initialization = None
    if args.initialize_from and not args.smoke:
        source_report = json.loads(
            (args.initialize_from / "training-report.json").read_text()
        )
        if (
            source_report.get("smoke_only")
            or source_report.get("backbone") != spec["backbone"]
            or source_report.get("revision") != spec["revision"]
        ):
            raise ValueError(
                "Initialization must be the pinned fine-tuned Arabic backbone."
            )
        tokenizer = AutoTokenizer.from_pretrained(args.initialize_from, use_fast=True)
        model = AutoModelForSequenceClassification.from_pretrained(
            args.initialize_from, attn_implementation="eager"
        )
        if len(model.bert.encoder.layer) != len(spec["retained_encoder_layers"]):
            raise ValueError(
                "Initialization encoder size differs from the selected Arabic candidate."
            )
        old_labels = model.config.id2label
        old_head = model.classifier
        model.classifier = nn.Linear(old_head.in_features, len(labels))
        nn.init.normal_(
            model.classifier.weight, mean=0.0, std=model.config.initializer_range
        )
        nn.init.zeros_(model.classifier.bias)
        aliases = {"letter_specific": "letter_mark", "letter_any": "any_letter_mark"}
        with torch.no_grad():
            for label, index in label2id.items():
                old = next(
                    (
                        key
                        for key, value in old_labels.items()
                        if value == aliases.get(label, label)
                    ),
                    None,
                )
                if old is not None:
                    model.classifier.weight[index].copy_(old_head.weight[old])
                    model.classifier.bias[index].copy_(old_head.bias[old])
        model.num_labels = len(labels)
        model.config.num_labels = len(labels)
        model.config.id2label = dict(enumerate(labels))
        model.config.label2id = label2id
        initialization = {
            "source_training_report_sha256": hashlib.sha256(
                (args.initialize_from / "training-report.json").read_bytes()
            ).hexdigest(),
            "source_weights_sha256": hashlib.sha256(
                (args.initialize_from / "model.safetensors").read_bytes()
            ).hexdigest(),
            "source_training_requests_sha256": source_report.get(
                "training_requests_sha256", []
            ),
        }
    elif args.smoke:
        # This checks plumbing only. It is intentionally not a pretrained Arabic model.
        # Use the real pinned Arabic tokenizer, so browser parity tests cover its normalization.
        tokenizer = AutoTokenizer.from_pretrained(
            spec["backbone"], revision=spec["revision"], use_fast=True
        )
        config = BertConfig(
            vocab_size=len(tokenizer),
            hidden_size=32,
            num_hidden_layers=2,
            num_attention_heads=4,
            intermediate_size=64,
            max_position_embeddings=128,
            num_labels=len(labels),
            id2label=dict(enumerate(labels)),
            label2id=label2id,
        )
        model = BertForSequenceClassification(config)
        train = train[:32]
        validation = validation[:16]
    else:
        tokenizer = AutoTokenizer.from_pretrained(
            spec["backbone"], revision=spec["revision"], use_fast=True
        )
        model = AutoModelForSequenceClassification.from_pretrained(
            spec["backbone"],
            revision=spec["revision"],
            num_labels=len(labels),
            id2label=dict(enumerate(labels)),
            label2id=label2id,
            attn_implementation="eager",
        )
        # Retain pretrained embeddings and six actual encoder layers; this is NOT KD distillation.
        retained = spec["retained_encoder_layers"]
        model.bert.encoder.layer = nn.ModuleList(
            [model.bert.encoder.layer[i] for i in retained]
        )
        model.config.num_hidden_layers = len(retained)
    tokenizer.model_max_length = spec["max_tokens"]
    model.config._attn_implementation = "eager"
    train, skipped_train = prepare_inputs(tokenizer, train, spec["max_tokens"])
    validation, skipped_validation = prepare_inputs(
        tokenizer, validation, spec["max_tokens"]
    )
    raw_train_count = len(train)
    if args.deduplicate_inputs:
        unique = {}
        for row in train:
            key = row["model_input"]
            if key in unique and unique[key]["intent"] != row["intent"]:
                raise ValueError("Conflicting intent labels for a masked input.")
            unique.setdefault(key, row)
        train = list(unique.values())
        validation = list({row["model_input"]: row for row in validation}.values())
    if not train or not validation:
        raise ValueError("No usable training/validation examples.")
    device = torch.device(args.device)
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    frequencies = np.bincount(
        [label2id[row["intent"]] for row in train], minlength=len(labels)
    )
    weights = torch.tensor(
        1 / np.maximum(frequencies, 1), dtype=torch.float32, device=device
    )
    weights /= weights.mean()
    loss_fn = nn.CrossEntropyLoss(weight=weights)
    best = -1
    step = 0
    history = []
    for epoch in range(args.epochs):
        model.train()
        random.shuffle(train)
        loss_sum = 0
        steps = 0
        for start in range(0, len(train), args.batch_size):
            batch = train[start : start + args.batch_size]
            inputs = tokenizer(
                [row["model_input"] for row in batch],
                padding=True,
                truncation=False,
                return_tensors="pt",
            ).to(device)
            targets = torch.tensor(
                [label2id[row["intent"]] for row in batch], device=device
            )
            optimizer.zero_grad()
            loss = loss_fn(model(**inputs).logits, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            loss_sum += loss.item()
            steps += 1
            step += 1
            if args.max_steps and step >= args.max_steps:
                break
        model.eval()
        counts = np.zeros(len(labels))
        correct = np.zeros(len(labels))
        with torch.no_grad():
            for start in range(0, len(validation), args.batch_size):
                batch = validation[start : start + args.batch_size]
                inputs = tokenizer(
                    [row["model_input"] for row in batch],
                    padding=True,
                    truncation=False,
                    return_tensors="pt",
                ).to(device)
                predicted = model(**inputs).logits.argmax(-1).cpu().tolist()
                for row, prediction in zip(batch, predicted):
                    idx = label2id[row["intent"]]
                    counts[idx] += 1
                    correct[idx] += prediction == idx
        accuracy = float(np.mean((correct / np.maximum(counts, 1))[counts > 0]))
        record = {
            "epoch": epoch + 1,
            "loss": loss_sum / max(steps, 1),
            "validation_macro_accuracy": accuracy,
        }
        history.append(record)
        print(json.dumps(record), flush=True)
        if accuracy > best:
            best = accuracy
            model.save_pretrained(args.output)
            tokenizer.save_pretrained(args.output)
        if args.max_steps and step >= args.max_steps:
            break
    report = {
        "backbone": spec["backbone"],
        "revision": spec["revision"],
        "retained_layers": None if args.smoke else spec["retained_encoder_layers"],
        "parameter_count": sum(p.numel() for p in model.parameters()),
        "seed": args.seed,
        "smoke_only": args.smoke,
        "training_steps": step,
        "train_examples": len(train),
        "usable_train_rows_before_deduplication": raw_train_count,
        "initialization": initialization,
        "validation_examples": len(validation),
        "skipped_train": skipped_train,
        "skipped_validation": skipped_validation,
        "history": history,
        "data_sha256": {
            name: hashlib.sha256(
                (args.data_dir / (name + ".jsonl")).read_bytes()
            ).hexdigest()
            for name in ["train", "validation"]
        },
        "training_requests_sha256": (
            initialization["source_training_requests_sha256"] if initialization else []
        )
        + [
            hashlib.sha256(row["request"].encode()).hexdigest()
            for row in train + validation
        ],
        "approved": False,
    }
    (args.output / "training-report.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    (args.output / "labels.json").write_text(json.dumps(labels, indent=2) + "\n")


if __name__ == "__main__":
    main()
