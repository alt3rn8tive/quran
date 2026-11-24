# Multilingual E5 model

This bundle uses [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) from Wang et al., which the model card licenses under the MIT License. The [ONNX conversion](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78) is from Xenova. The project retains the quantized encoder and an Arabic subset of the tokenizer and token embeddings. See [the MIT license](LICENSE-MIT.txt).

Paper: [Multilingual E5 Text Embeddings: A Technical Report](https://arxiv.org/abs/2402.05672).

Quran verse text comes from the website's existing `js/data.js`. This bundle contains only verse references and vectors. Its browser runtime comes from the already distributed Transformers.js and ONNX Runtime package, with its accompanying licenses.
