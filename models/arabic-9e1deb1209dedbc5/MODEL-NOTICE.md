# Experimental Arabic query planner

Derived from CAMeL-Lab/bert-base-arabic-camelbert-mix, revision
9be352797bdf28a9ae21e2ae582aaaca7abdb22d, by CAMeL Lab.
Original model: https://huggingface.co/CAMeL-Lab/bert-base-arabic-camelbert-mix
The upstream model card declares Apache-2.0; see LICENSE-Apache-2.0.txt.

Changes: retain pretrained encoder layers 0, 2, 4, 7, 9, 11; replace the
pretraining head with a 29-class query-intent head; supervised fine-tuning
on this repository's synthetic draft Arabic requests; unsigned 8-bit ONNX quantization.

This experimental derivative is not endorsed by CAMeL Lab. It has not passed
the independent Arabic review or physical-device production release gates.
Its output must be reviewed as editable search components before use.
